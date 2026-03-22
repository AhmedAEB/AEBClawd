import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsP from "node:fs/promises";
import { resolveAndValidate, getWorkspacesRoot } from "@aebclawd/core";

export const exec = promisify(execFile);

export function trunc(s: string, n = 4000) {
  return s.length <= n ? s : s.slice(0, n) + "\n…<i>(truncated)</i>";
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

const IGNORE = new Set([
  "node_modules", "dist", "build", ".next", ".git",
  "__pycache__", ".venv", "coverage", ".cache", ".turbo",
]);

export async function dirs(rel: string): Promise<string[]> {
  const r = rel ? resolveAndValidate(rel) : getWorkspacesRoot();
  const e = await fsP.readdir(r, { withFileTypes: true });
  return e
    .filter(x => x.isDirectory() && !x.name.startsWith(".") && !IGNORE.has(x.name))
    .map(x => x.name)
    .sort();
}

export async function gStatus(rel: string) {
  const d = resolveAndValidate(rel);
  let branch = "?";
  try {
    branch = (await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: d })).stdout.trim();
  } catch {}
  const { stdout } = await exec("git", ["status", "--porcelain=v2", "-uall"], { cwd: d, maxBuffer: 10 * 1024 * 1024 });
  const staged: any[] = [], unstaged: any[] = [], untracked: any[] = [];
  for (const ln of stdout.split("\n").filter(Boolean)) {
    if (ln.startsWith("?")) { untracked.push({ file: ln.slice(2) }); continue; }
    if (!ln.startsWith("1") && !ln.startsWith("2")) continue;
    const p = ln.split(" "), xy = p[1];
    const file = ln.startsWith("2")
      ? p.slice(9).join(" ").split("\t").pop()!
      : p.slice(8).join(" ");
    if (xy[0] !== ".") staged.push({ file, status: xy[0] });
    if (xy[1] !== ".") unstaged.push({ file, status: xy[1] });
  }
  return { branch, staged, unstaged, untracked };
}

export async function gLog(rel: string) {
  const d = resolveAndValidate(rel);
  const { stdout } = await exec("git", ["log", "--max-count=10", "--format=%h %s (%cr)"], { cwd: d });
  return stdout.trim().split("\n").filter(Boolean);
}

export function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== "object") return name;
  const i = input as Record<string, any>;
  switch (name) {
    case "Read": return `Read: ${i.file_path?.split("/").pop() || ""}`;
    case "Write": return `Write: ${i.file_path?.split("/").pop() || ""}`;
    case "Edit": return `Edit: ${i.file_path?.split("/").pop() || ""}`;
    case "Bash": {
      const cmd = (i.command || "").slice(0, 40);
      return `Bash: ${cmd}${(i.command || "").length > 40 ? "…" : ""}`;
    }
    case "Glob": return `Glob: ${i.pattern || ""}`;
    case "Grep": return `Grep: ${(i.pattern || "").slice(0, 30)}`;
    case "Agent": return `Agent: ${(i.description || "").slice(0, 30)}`;
    default: return name;
  }
}
