import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAndValidate, getWorkspacesRoot } from "../lib/paths.js";

const filesystem = new Hono();

filesystem.get("/", async (c) => {
  const relativePath = c.req.query("path") ?? "";

  let resolved: string;
  try {
    resolved = relativePath ? resolveAndValidate(relativePath) : getWorkspacesRoot();
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return c.json({ path: relativePath || "", entries: items });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return c.json({ error: "Directory not found" }, 404);
    }
    return c.json({ error: "Failed to read directory" }, 500);
  }
});

/** Read file contents */
filesystem.get("/read", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath) {
    return c.json({ error: "path query parameter is required" }, 400);
  }

  let resolved: string;
  try {
    resolved = resolveAndValidate(filePath);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    const stat = await fs.stat(resolved);
    // Reject files larger than 5MB to avoid memory issues
    if (stat.size > 5 * 1024 * 1024) {
      return c.json({ error: "File too large (max 5MB)" }, 413);
    }
    const content = await fs.readFile(resolved, "utf-8");
    return c.json({ path: filePath, content });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return c.json({ error: "File not found" }, 404);
    }
    return c.json({ error: "Failed to read file" }, 500);
  }
});

/** Write file contents */
filesystem.post("/write", async (c) => {
  const body = await c.req.json();
  const { path: filePath, content } = body;

  if (!filePath || typeof filePath !== "string") {
    return c.json({ error: "path is required" }, 400);
  }
  if (typeof content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }

  let resolved: string;
  try {
    resolved = resolveAndValidate(filePath);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    return c.json({ ok: true, path: filePath });
  } catch {
    return c.json({ error: "Failed to write file" }, 500);
  }
});

filesystem.post("/mkdir", async (c) => {
  const { path: dirPath } = await c.req.json();
  if (!dirPath || typeof dirPath !== "string") {
    return c.json({ error: "path is required" }, 400);
  }

  let resolved: string;
  try {
    resolved = resolveAndValidate(dirPath);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  try {
    await fs.mkdir(resolved, { recursive: true });
    return c.json({ ok: true, path: dirPath });
  } catch {
    return c.json({ error: "Failed to create directory" }, 500);
  }
});

filesystem.post("/rmdir", async (c) => {
  const { path: dirPath } = await c.req.json();
  if (!dirPath || typeof dirPath !== "string") {
    return c.json({ error: "path is required" }, 400);
  }

  let resolved: string;
  try {
    resolved = resolveAndValidate(dirPath);
  } catch {
    return c.json({ error: "Path is outside workspace root" }, 403);
  }

  if (resolved === getWorkspacesRoot()) {
    return c.json({ error: "Cannot delete workspace root" }, 403);
  }

  try {
    await fs.rmdir(resolved);
    return c.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ENOTEMPTY") {
      return c.json({ error: "Directory is not empty" }, 400);
    }
    if (err.code === "ENOENT") {
      return c.json({ error: "Directory not found" }, 404);
    }
    return c.json({ error: "Failed to delete directory" }, 500);
  }
});

export default filesystem;
