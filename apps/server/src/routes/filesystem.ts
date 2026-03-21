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
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, isDirectory: true }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({ path: relativePath || "", entries: dirs });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return c.json({ error: "Directory not found" }, 404);
    }
    return c.json({ error: "Failed to read directory" }, 500);
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
