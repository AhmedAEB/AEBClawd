import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAndValidate } from "../lib/paths.js";

const exec = promisify(execFile);
const git = new Hono();

function getDir(c: any): string {
  const rel = c.req.query("dir") ?? "";
  if (!rel) throw new Error("dir query parameter is required");
  return resolveAndValidate(rel);
}

async function run(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return exec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

// GET /status?dir=...
git.get("/status", async (c) => {
  let dir: string;
  try {
    dir = getDir(c);
  } catch {
    return c.json({ error: "dir is required" }, 400);
  }

  try {
    const { stdout: branchOut } = await run(dir, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const branch = branchOut.trim();

    // porcelain v2 gives machine-readable status
    const { stdout } = await run(dir, ["status", "--porcelain=v2", "-uall"]);
    const staged: { file: string; status: string }[] = [];
    const unstaged: { file: string; status: string }[] = [];
    const untracked: { file: string }[] = [];

    for (const line of stdout.split("\n").filter(Boolean)) {
      if (line.startsWith("?")) {
        // untracked
        const file = line.slice(2);
        untracked.push({ file });
      } else if (line.startsWith("1") || line.startsWith("2")) {
        // ordinary or rename/copy
        const parts = line.split(" ");
        const xy = parts[1]; // XY status codes
        const file =
          line.startsWith("2")
            ? parts.slice(9).join(" ").split("\t").pop()!
            : parts.slice(8).join(" ");

        if (xy[0] !== ".") {
          staged.push({ file, status: xy[0] });
        }
        if (xy[1] !== ".") {
          unstaged.push({ file, status: xy[1] });
        }
      }
    }

    return c.json({ branch, staged, unstaged, untracked });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to get git status" }, 500);
  }
});

// GET /log?dir=...&limit=50
git.get("/log", async (c) => {
  let dir: string;
  try {
    dir = getDir(c);
  } catch {
    return c.json({ error: "dir is required" }, 400);
  }

  const limit = c.req.query("limit") ?? "50";

  try {
    const { stdout } = await run(dir, [
      "log",
      `--max-count=${limit}`,
      "--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s%x00%D%x00%P",
      "--graph",
      "--all",
    ]);

    const commits: any[] = [];
    for (const line of stdout.split("\n").filter(Boolean)) {
      // Graph lines have leading graph chars before the commit data
      const graphMatch = line.match(/^([*|/\\ \n]+?)([0-9a-f]{40}\x00.*)$/);
      if (graphMatch) {
        const graph = graphMatch[1].trimEnd();
        const parts = graphMatch[2].split("\x00");
        commits.push({
          graph,
          hash: parts[0],
          shortHash: parts[1],
          author: parts[2],
          email: parts[3],
          timestamp: Number(parts[4]) * 1000,
          subject: parts[5],
          refs: parts[6] ? parts[6].split(", ").filter(Boolean) : [],
          parents: parts[7] ? parts[7].trim().split(" ").filter(Boolean) : [],
        });
      } else {
        // pure graph line (no commit)
        commits.push({ graph: line.trimEnd(), graphOnly: true });
      }
    }

    return c.json({ commits });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to get git log" }, 500);
  }
});

// GET /diff?dir=...&file=...&staged=true/false
git.get("/diff", async (c) => {
  let dir: string;
  try {
    dir = getDir(c);
  } catch {
    return c.json({ error: "dir is required" }, 400);
  }

  const file = c.req.query("file");
  const isStaged = c.req.query("staged") === "true";

  try {
    const args = ["diff"];
    if (isStaged) args.push("--cached");
    if (file) args.push("--", file);

    const { stdout } = await run(dir, args);
    return c.json({ diff: stdout });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to get diff" }, 500);
  }
});

// POST /stage { dir, files }
git.post("/stage", async (c) => {
  const { dir: rel, files } = await c.req.json();
  if (!rel) return c.json({ error: "dir is required" }, 400);

  let dir: string;
  try {
    dir = resolveAndValidate(rel);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    const fileList = Array.isArray(files) ? files : ["."];
    await run(dir, ["add", "--", ...fileList]);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to stage files" }, 500);
  }
});

// POST /unstage { dir, files }
git.post("/unstage", async (c) => {
  const { dir: rel, files } = await c.req.json();
  if (!rel) return c.json({ error: "dir is required" }, 400);

  let dir: string;
  try {
    dir = resolveAndValidate(rel);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    const fileList = Array.isArray(files) ? files : ["."];
    await run(dir, ["reset", "HEAD", "--", ...fileList]);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to unstage files" }, 500);
  }
});

// POST /commit { dir, message }
git.post("/commit", async (c) => {
  const { dir: rel, message } = await c.req.json();
  if (!rel) return c.json({ error: "dir is required" }, 400);
  if (!message || typeof message !== "string" || !message.trim()) {
    return c.json({ error: "message is required" }, 400);
  }

  let dir: string;
  try {
    dir = resolveAndValidate(rel);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    const { stdout } = await run(dir, ["commit", "-m", message.trim()]);
    return c.json({ ok: true, output: stdout });
  } catch (err: any) {
    return c.json(
      { error: err.stderr || err.message || "Failed to commit" },
      500
    );
  }
});

// POST /discard { dir, files }
git.post("/discard", async (c) => {
  const { dir: rel, files } = await c.req.json();
  if (!rel) return c.json({ error: "dir is required" }, 400);

  let dir: string;
  try {
    dir = resolveAndValidate(rel);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    const fileList = Array.isArray(files) ? files : [];
    if (fileList.length === 0)
      return c.json({ error: "files array is required" }, 400);
    await run(dir, ["checkout", "--", ...fileList]);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json(
      { error: err.message || "Failed to discard changes" },
      500
    );
  }
});

export default git;
