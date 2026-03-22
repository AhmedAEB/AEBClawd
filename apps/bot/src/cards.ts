import { Card, CardText, Actions, Button } from "chat";
import { getWorkspacesRoot } from "@aebclawd/core";
import { chunk } from "./helpers.js";
import type { Ctx } from "./context.js";

export function wsRootCard(list: string[], page: number) {
  const PP = 9, total = Math.ceil(list.length / PP) || 1;
  const slice = list.slice(page * PP, (page + 1) * PP);
  const children: any[] = [CardText(`Select a project to start chatting with Claude Code.\n\n📂 ${getWorkspacesRoot()}`)];
  if (slice.length > 0) {
    for (const row of chunk(slice, 3))
      children.push(Actions(row.map(d => Button({ id: "op", value: d, label: d }))));
  } else {
    children.push(CardText("No projects."));
  }
  if (total > 1) {
    const nav: any[] = [];
    if (page > 0) nav.push(Button({ id: "rp", value: `${page - 1}`, label: "◀ Prev" }));
    nav.push(Button({ id: "x", value: "x", label: `${page + 1}/${total}` }));
    if (page < total - 1) nav.push(Button({ id: "rp", value: `${page + 1}`, label: "Next ▶" }));
    children.push(Actions(nav));
  }
  children.push(Actions([Button({ id: "mk", value: ".", label: "+ New Folder" })]));
  return Card({ title: "WORKSPACES", children });
}

export function projectCard(name: string) {
  return Card({
    title: `📂 ${name}`,
    children: [
      Actions([
        Button({ id: "ns", value: ".", label: "New Chat", style: "primary" }),
        Button({ id: "ss", value: ".", label: "Sessions" }),
      ]),
      Actions([
        Button({ id: "gt", value: ".", label: "Git" }),
        Button({ id: "bk", value: ".", label: "⬅ Back" }),
      ]),
    ],
  });
}

export function ssCard(list: any[], wd: string, sessionMap: Map<string, string>) {
  const children: any[] = [CardText(wd || "(root)")];
  if (list.length === 0) {
    children.push(CardText("No sessions yet."));
  } else {
    const btns = list.slice(0, 6).map((s: any, i: number) => {
      const key = `${i}`;
      sessionMap.set(key, s.sessionId);
      const lb = (s.customTitle || s.summary || s.firstPrompt || "Untitled").slice(0, 24);
      return Button({ id: "rs", value: key, label: `${i + 1}. ${lb}` });
    });
    for (const row of chunk(btns, 2)) children.push(Actions(row));
  }
  children.push(Actions([
    Button({ id: "ns", value: ".", label: "New Session", style: "primary" }),
    Button({ id: "up", value: ".", label: "⬅ Back" }),
  ]));
  return Card({ title: "SESSIONS", children });
}

export function statusLine(c: Ctx): string {
  return `\n\n📍 ${c.workDir || "(none)"} · Send a message to chat`;
}

export function chatCard(wd: string, label: string) {
  return `💬 ${wd} — ${label}\n\nSend any message to chat.\n\n📍 ${wd} · /stop /new /start`;
}

export function gitCard(st: any) {
  const lines = [`Branch: ${st.branch}`];
  const total = st.staged.length + st.unstaged.length + st.untracked.length;
  if (st.staged.length) {
    lines.push(`\nSTAGED (${st.staged.length}):`);
    st.staged.slice(0, 8).forEach((f: any) => lines.push(`  + ${f.file}`));
    if (st.staged.length > 8) lines.push(`  …+${st.staged.length - 8}`);
  }
  if (st.unstaged.length) {
    lines.push(`\nCHANGES (${st.unstaged.length}):`);
    st.unstaged.slice(0, 8).forEach((f: any) => lines.push(`  ~ ${f.file}`));
    if (st.unstaged.length > 8) lines.push(`  …+${st.unstaged.length - 8}`);
  }
  if (st.untracked.length) {
    lines.push(`\nUNTRACKED (${st.untracked.length}):`);
    st.untracked.slice(0, 8).forEach((f: any) => lines.push(`  ? ${f.file}`));
    if (st.untracked.length > 8) lines.push(`  …+${st.untracked.length - 8}`);
  }
  if (total === 0) lines.push("\n✓ Clean");
  const children: any[] = [CardText(lines.join("\n"))];
  const row1: any[] = [];
  if (st.unstaged.length + st.untracked.length > 0) row1.push(Button({ id: "ga", value: "sa", label: "Stage All", style: "primary" }));
  if (st.staged.length > 0) row1.push(Button({ id: "ga", value: "ua", label: "Unstage" }));
  if (st.staged.length > 0) row1.push(Button({ id: "ga", value: "cm", label: "Commit" }));
  if (row1.length) children.push(Actions(row1));
  if (st.staged.length > 0) {
    children.push(Actions([Button({ id: "ga", value: "ac", label: "✨ Auto Commit" })]));
  }
  children.push(Actions([
    Button({ id: "ga", value: "pl", label: "Pull" }),
    Button({ id: "ga", value: "ps", label: "Push" }),
    Button({ id: "ga", value: "lg", label: "Log" }),
  ]));
  children.push(Actions([
    Button({ id: "ga", value: "rf", label: "Refresh" }),
    Button({ id: "up", value: ".", label: "⬅ Back" }),
  ]));
  return Card({ title: "GIT", children });
}

export function logCard(commits: string[]) {
  return Card({
    title: "GIT LOG",
    children: [
      CardText(commits.length ? commits.join("\n") : "No commits."),
      Actions([
        Button({ id: "gt", value: ".", label: "⬅ Status" }),
        Button({ id: "up", value: ".", label: "⬅ Back" }),
      ]),
    ],
  });
}

export function approvalCard(toolName: string, summary: string, toolUseId: string) {
  return Card({
    title: `🔐 ${toolName}`,
    children: [
      CardText(summary),
      Actions([
        Button({ id: "ta", value: `a:${toolUseId.slice(0, 50)}`, label: "✅ Allow", style: "primary" }),
        Button({ id: "ta", value: `d:${toolUseId.slice(0, 50)}`, label: "❌ Deny" }),
      ]),
    ],
  });
}
