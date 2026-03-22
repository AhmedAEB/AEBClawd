import path from "node:path";
import { coreEnv } from "./env.js";

export function resolveAndValidate(relativePath: string): string {
  const root = path.resolve(coreEnv.WORKSPACES_ROOT);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error("Path is outside workspace root");
  }
  return resolved;
}

export function getWorkspacesRoot(): string {
  return path.resolve(coreEnv.WORKSPACES_ROOT);
}
