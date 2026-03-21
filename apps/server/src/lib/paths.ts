import path from "node:path";
import { env } from "./env.js";

/**
 * Resolves a relative path against WORKSPACES_ROOT and validates
 * that the result is within the root. Returns the absolute path.
 * Throws if the path escapes the root.
 */
export function resolveAndValidate(relativePath: string): string {
  const root = path.resolve(env.WORKSPACES_ROOT);
  const resolved = path.resolve(root, relativePath);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error("Path is outside workspace root");
  }

  return resolved;
}

/**
 * Returns the resolved WORKSPACES_ROOT absolute path.
 */
export function getWorkspacesRoot(): string {
  return path.resolve(env.WORKSPACES_ROOT);
}
