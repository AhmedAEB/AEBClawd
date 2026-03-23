#!/usr/bin/env tsx
/**
 * Auto-generates a Bruno API collection by parsing Hono route source files.
 *
 * Discovers:
 *  - Route registrations  (router.get("/path", ...))
 *  - Query params          (c.req.query("name") ?? "default")
 *  - JSON body fields      (const { a, b } = await c.req.json())
 *  - Route mounting        (app.route("/prefix", router))
 *
 * Run:  npx tsx scripts/generate-bruno.ts
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");
const BRUNO = join(__dirname, "..", "bruno");

// ── Types ────────────────────────────────────────────────────────────────────

interface Route {
  method: string;
  path: string;
  queryParams: Record<string, string>;
  bodyFields: string[];
}

// ── Source parsing ───────────────────────────────────────────────────────────

function discoverRoutes(): Route[] {
  const routes: Route[] = [];
  const indexSrc = readFileSync(join(SRC, "index.ts"), "utf-8");

  // Inline routes on the app itself  (app.get("/", ...))
  for (const m of indexSrc.matchAll(
    /app\.(get|post|put|patch|delete)\(["']([^"']+)["']/g,
  )) {
    routes.push({
      method: m[1].toUpperCase(),
      path: m[2],
      queryParams: {},
      bodyFields: [],
    });
  }

  // Mounted sub-routers:  app.route("/prefix", varName)
  const mounts: Array<{ prefix: string; varName: string }> = [];
  for (const m of indexSrc.matchAll(
    /app\.route\(["']([^"']+)["'],\s*(\w+)\)/g,
  )) {
    mounts.push({ prefix: m[1], varName: m[2] });
  }

  for (const mount of mounts) {
    const importMatch = indexSrc.match(
      new RegExp(
        `import\\s+${mount.varName}\\s+from\\s+["']\\.\/routes\/([^"']+)["']`,
      ),
    );
    if (!importMatch) continue;

    const routeFile = join(SRC, "routes", importMatch[1].replace(".js", ".ts"));
    if (!existsSync(routeFile)) continue;

    routes.push(...parseRouteFile(routeFile, mount.prefix));
  }

  return routes;
}

function parseRouteFile(filePath: string, prefix: string): Route[] {
  const src = readFileSync(filePath, "utf-8");
  const routes: Route[] = [];

  // Find the router variable:  const stream = new Hono();
  const varMatch = src.match(/const\s+(\w+)\s*=\s*new\s+Hono/);
  if (!varMatch) return routes;
  const routeVar = varMatch[1];

  // Collect all handler positions
  const handlerRe = new RegExp(
    `${routeVar}\\.(get|post|put|patch|delete)\\(["']([^"']+)["']`,
    "g",
  );
  const handlers = [...src.matchAll(handlerRe)];

  for (let i = 0; i < handlers.length; i++) {
    const h = handlers[i];
    const method = h[1].toUpperCase();
    const subPath = h[2];
    const fullPath = prefix + (subPath === "/" ? "" : subPath);

    // Slice handler body (from this match to the next, or EOF)
    const start = h.index!;
    const end =
      i + 1 < handlers.length ? handlers[i + 1].index! : src.length;
    const body = src.slice(start, end);

    // Query params:  c.req.query("limit") ?? "50"
    const queryParams: Record<string, string> = {};
    for (const qm of body.matchAll(
      /c\.req\.query\(["'](\w+)["']\)(?:\s*\?\?\s*["']([^"']*)["'])?/g,
    )) {
      queryParams[qm[1]] = qm[2] ?? "";
    }

    // JSON body:  const { a, b } = await c.req.json()
    let bodyFields: string[] = [];
    const bodyMatch = body.match(
      /(?:const|let)\s*\{([^}]+)\}\s*=\s*await\s+c\.req\.json\(\)/,
    );
    if (bodyMatch) {
      bodyFields = bodyMatch[1].split(",").map((f) => f.trim());
    }

    routes.push({ method, path: fullPath || "/", queryParams, bodyFields });
  }

  return routes;
}

// ── Bruno generation ─────────────────────────────────────────────────────────

function routeToName(method: string, path: string): string {
  if (path === "/") return "Health Check";

  const segments = path
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean);

  const words = segments.map((s) => {
    if (s.startsWith(":")) return `by ${s.slice(1)}`;
    return s
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  });

  return words.join(" ");
}

function routeToFolder(path: string): string {
  if (path === "/") return "";
  const first = path.replace(/^\/api\//, "").split("/").filter(Boolean)[0];
  return first?.startsWith(":") ? "" : first ?? "";
}

function toBru(route: Route): string {
  const name = routeToName(route.method, route.path);
  const method = route.method.toLowerCase();
  const hasBody = route.bodyFields.length > 0;

  const sections: string[] = [];

  sections.push(`meta {
  name: ${name}
  type: http
  seq: 1
}`);

  sections.push(`${method} {
  url: {{baseUrl}}${route.path}
  body: ${hasBody ? "json" : "none"}
  auth: none
}`);

  if (Object.keys(route.queryParams).length > 0) {
    const lines = Object.entries(route.queryParams)
      .map(([k, v]) => `  ~${k}: ${v}`)
      .join("\n");
    sections.push(`params:query {\n${lines}\n}`);
  }

  if (hasBody) {
    const obj: Record<string, string> = {};
    for (const f of route.bodyFields) obj[f] = "";
    const json = JSON.stringify(obj, null, 2);
    sections.push(`body:json {\n${indent(json, 2)}\n}`);
  }

  return sections.join("\n\n") + "\n";
}

function indent(str: string, n: number): string {
  const pad = " ".repeat(n);
  return str
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

// ── File writing ─────────────────────────────────────────────────────────────

function cleanGeneratedFolders(keep: Set<string>) {
  if (!existsSync(BRUNO)) return;
  for (const entry of readdirSync(BRUNO)) {
    const full = join(BRUNO, entry);
    if (
      statSync(full).isDirectory() &&
      entry !== "environments" &&
      !keep.has(entry)
    ) {
      rmSync(full, { recursive: true });
    }
  }
}

function main() {
  const routes = discoverRoutes();

  // Determine which folders we'll need
  const folders = new Set<string>();
  for (const r of routes) {
    const f = routeToFolder(r.path);
    if (f) folders.add(f);
  }

  // Cleanup stale generated folders
  cleanGeneratedFolders(folders);

  // Ensure directory structure
  mkdirSync(BRUNO, { recursive: true });
  mkdirSync(join(BRUNO, "environments"), { recursive: true });
  for (const f of folders) {
    mkdirSync(join(BRUNO, f), { recursive: true });
  }

  // bruno.json  (collection manifest)
  writeFileSync(
    join(BRUNO, "bruno.json"),
    JSON.stringify(
      {
        version: "1",
        name: "AEBClawd API",
        type: "collection",
        ignore: ["node_modules", ".git"],
      },
      null,
      2,
    ) + "\n",
  );

  // collection.bru (uses vars:pre-request, not bare vars)
  writeFileSync(
    join(BRUNO, "collection.bru"),
    `meta {
  name: AEBClawd API
  type: collection
}

vars:pre-request {
  baseUrl: http://localhost:3001
}
`,
  );

  // Environment
  writeFileSync(
    join(BRUNO, "environments", "local.bru"),
    `vars {
  baseUrl: http://localhost:3001
}
`,
  );

  // Route files
  for (const route of routes) {
    const folder = routeToFolder(route.path);
    const fileName = routeToName(route.method, route.path) + ".bru";
    const dir = folder ? join(BRUNO, folder) : BRUNO;
    writeFileSync(join(dir, fileName), toBru(route));
  }

  console.log(
    `✓ Bruno collection generated — ${routes.length} requests in ${BRUNO}`,
  );
}

main();
