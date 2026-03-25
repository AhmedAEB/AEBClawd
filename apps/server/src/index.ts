import { existsSync, mkdirSync, symlinkSync, lstatSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";

// Persist apt packages across deploys using DATA_DIR volume
if (env.DATA_DIR && existsSync(env.DATA_DIR)) {
  const aptDir = join(env.DATA_DIR, ".apt");
  const aptCache = join(aptDir, "archives");
  const pkgListFile = join(aptDir, "packages");
  mkdirSync(aptCache, { recursive: true });

  // Symlink apt archive cache to persistent volume so .deb files survive deploys
  const sysCache = "/var/cache/apt/archives";
  try {
    const isSym = lstatSync(sysCache).isSymbolicLink();
    if (!isSym) {
      execSync(`cp -rn ${sysCache}/*.deb ${aptCache}/ 2>/dev/null || true`, { stdio: "pipe" });
      execSync(`rm -rf ${sysCache}`, { stdio: "pipe" });
      symlinkSync(aptCache, sysCache);
      logger.info(`Symlinked apt cache -> ${aptCache}`);
    }
  } catch {
    try { symlinkSync(aptCache, sysCache); } catch {}
  }

  // Restore previously saved packages from the persistent list
  if (existsSync(pkgListFile)) {
    const pkgs = readFileSync(pkgListFile, "utf-8").trim();
    if (pkgs) {
      logger.info(`Restoring apt packages: ${pkgs}`);
      try {
        execSync(`apt-get update -qq && apt-get install -y -qq ${pkgs}`, { stdio: "pipe" });
        logger.info("apt packages restored successfully");
      } catch (e) {
        logger.warn("Failed to restore apt packages: " + (e instanceof Error ? e.message : e));
      }
    }
  }

  // Helper: call persistAptPackage("git") to add a package to the survive list
  (globalThis as any).persistAptPackage = (pkg: string) => {
    const existing = existsSync(pkgListFile) ? readFileSync(pkgListFile, "utf-8").trim() : "";
    const pkgSet = new Set(existing.split(/\s+/).filter(Boolean));
    if (!pkgSet.has(pkg)) {
      pkgSet.add(pkg);
      writeFileSync(pkgListFile, [...pkgSet].join("\n") + "\n");
      logger.info(`Added "${pkg}" to persistent apt packages`);
    }
  };

  // Seed with git (required for source control features)
  (globalThis as any).persistAptPackage("git");
}

// Persist ~/.claude on a volume so auth tokens survive deploys
if (env.DATA_DIR && existsSync(env.DATA_DIR)) {
  const claudeData = join(env.DATA_DIR, ".claude");
  const claudeHome = join(homedir(), ".claude");
  mkdirSync(claudeData, { recursive: true });
  let needsLink = true;
  try { needsLink = !lstatSync(claudeHome).isSymbolicLink() && !existsSync(claudeHome); } catch {}
  if (needsLink) {
    try { symlinkSync(claudeData, claudeHome); logger.info(`Symlinked ${claudeHome} -> ${claudeData}`); } catch {}
  }
  // Restore ~/.claude.json from backup if missing
  const claudeJson = join(homedir(), ".claude.json");
  if (!existsSync(claudeJson)) {
    const backupsDir = join(claudeData, "backups");
    if (existsSync(backupsDir)) {
      const latest = readdirSync(backupsDir).filter((f) => f.startsWith(".claude.json.backup.")).sort().pop();
      if (latest) { copyFileSync(join(backupsDir, latest), claudeJson); logger.info(`Restored ${claudeJson} from backup`); }
    }
  }
}
import sessions from "./routes/sessions.js";
import stream from "./routes/stream.js";
import filesystem from "./routes/filesystem.js";
import git from "./routes/git.js";
import models from "./routes/models.js";
import { createVoiceHandler } from "./routes/voice.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// WebSocket route MUST be mounted before cors() middleware
app.get("/ws/voice", createVoiceHandler(upgradeWebSocket));

// CORS for HTTP API routes only
app.use("/api/*", cors());

app.route("/api/sessions", sessions);
app.route("/api/stream", stream);
app.route("/api/filesystem", filesystem);
app.route("/api/git", git);
app.route("/api/models", models);

app.get("/health", (c) => c.json({ status: "ok" }));

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, () => {
  logger.info(`Server listening on 0.0.0.0:${env.PORT}`);
});

injectWebSocket(server);
