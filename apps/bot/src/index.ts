import { Chat, Card, CardText, Actions, Button } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createGitHubAdapter } from "@chat-adapter/github";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsP from "node:fs/promises";
import pathMod from "node:path";
import { logger, runQuery, resolveAndValidate, getWorkspacesRoot } from "@aebclawd/core";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ToolApprovalResult } from "@aebclawd/core";

const exec = promisify(execFile);

// ── Adapters ──
function buildAdapters(): Record<string, any> {
  const a: Record<string, any> = {};
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) a.slack = createSlackAdapter();
  if (process.env.DISCORD_TOKEN && process.env.DISCORD_PUBLIC_KEY) a.discord = createDiscordAdapter();
  if (process.env.TEAMS_APP_ID && process.env.TEAMS_APP_PASSWORD) a.teams = createTeamsAdapter();
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_WEBHOOK_SECRET) a.github = createGitHubAdapter();
  if (process.env.TELEGRAM_BOT_TOKEN) a.telegram = createTelegramAdapter({ mode: "polling" });
  return a;
}
const adapters = buildAdapters();
if (Object.keys(adapters).length === 0) {
  logger.error("[bot] No adapters configured. Set at least one platform's env vars.");
  process.exit(1);
}

const bot = new Chat({
  userName: process.env.BOT_USERNAME || "aebclawd",
  adapters, state: createMemoryState(), logger: "info",
  onLockConflict: "force", streamingUpdateIntervalMs: 600,
  fallbackStreamingPlaceholderText: null,
});

// ── User state ──
interface Ctx {
  workDir: string;
  sessionId: string | undefined;
  busy: boolean;
  abort: AbortController | null;
  awaiting: string | null;
  sessMap: Map<string, string>;
  pendingApprovals: Map<string, { resolve: (r: ToolApprovalResult) => void; input: Record<string, unknown> }>;
}
const ctxMap = new Map<string, Ctx>();
function ctx(id: string): Ctx {
  let c = ctxMap.get(id);
  if (!c) { c = { workDir: "", sessionId: undefined, busy: false, abort: null, awaiting: null, sessMap: new Map(), pendingApprovals: new Map() }; ctxMap.set(id, c); }
  return c;
}

// ── Data helpers ──
function trunc(s: string, n = 4000) { return s.length <= n ? s : s.slice(0, n) + "\n…<i>(truncated)</i>"; }

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

// Convert Markdown → Telegram HTML (most reliable rendering)
function mdToTgHtml(md: string): string {
  let s = md;
  // Escape HTML entities first
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Code blocks: ```lang\n...\n``` → <pre>...</pre>
  s = s.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);
  // Inline code: `...` → <code>...</code>
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold: **...** or __...__
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/__(.+?)__/g, "<b>$1</b>");
  // Italic: *...* or _..._  (but not inside words)
  s = s.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
  s = s.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");
  // Strikethrough: ~~...~~
  s = s.replace(/~~(.+?)~~/g, "<s>$1</s>");
  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // MD tables → pre block (Telegram has no table support)
  s = s.replace(/(\|.+\|[ \t]*\n\|[-| :]+\|[ \t]*\n(?:\|.+\|[ \t]*\n?)+)/g, (table) => {
    // Unescape for display inside pre
    return `<pre>${table.trim()}</pre>`;
  });
  // Headings: # ... → bold
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  return s;
}

// Direct Telegram API call for editing with HTML parse_mode
async function tgEdit(chatId: string, messageId: string, text: string) {
  // Try HTML first, fall back to plain text if Telegram rejects
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: parseInt(messageId, 10), text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json() as any;
  if (!j.ok && j.description?.includes("parse")) {
    // HTML parse error — retry as plain text
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: parseInt(messageId, 10), text: text.replace(/<[^>]+>/g, ""), disable_web_page_preview: true }),
    }).catch(() => {});
  }
}

async function tgSend(chatId: string, text: string): Promise<string | null> {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json() as any;
  if (!j.ok && j.description?.includes("parse")) {
    // Retry without HTML
    const r2 = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.replace(/<[^>]+>/g, ""), disable_web_page_preview: true }),
    });
    const j2 = await r2.json() as any;
    return j2.result?.message_id?.toString() ?? null;
  }
  return j.result?.message_id?.toString() ?? null;
}

// Extract Telegram chat_id from thread id (format: "telegram:CHATID" or "telegram:CHATID:...")
function tgChatId(threadId: string): string {
  const parts = threadId.split(":");
  return parts[1] ?? parts[0];
}

const IGNORE = new Set(["node_modules","dist","build",".next",".git","__pycache__",".venv","coverage",".cache",".turbo"]);
async function dirs(rel: string) {
  const r = rel ? resolveAndValidate(rel) : getWorkspacesRoot();
  const e = await fsP.readdir(r, { withFileTypes: true });
  return e.filter(x => x.isDirectory() && !x.name.startsWith(".") && !IGNORE.has(x.name)).map(x => x.name).sort();
}
async function fetchSessions(rel: string) {
  return listSessions({ dir: rel ? resolveAndValidate(rel) : getWorkspacesRoot(), limit: 20 });
}
async function gStatus(rel: string) {
  const d = resolveAndValidate(rel);
  let branch = "?";
  try { branch = (await exec("git", ["rev-parse","--abbrev-ref","HEAD"], { cwd: d })).stdout.trim(); } catch {}
  const { stdout } = await exec("git", ["status","--porcelain=v2","-uall"], { cwd: d, maxBuffer: 10*1024*1024 });
  const staged: any[] = [], unstaged: any[] = [], untracked: any[] = [];
  for (const ln of stdout.split("\n").filter(Boolean)) {
    if (ln.startsWith("?")) { untracked.push({ file: ln.slice(2) }); continue; }
    if (!ln.startsWith("1") && !ln.startsWith("2")) continue;
    const p = ln.split(" "), xy = p[1];
    const file = ln.startsWith("2") ? p.slice(9).join(" ").split("\t").pop()! : p.slice(8).join(" ");
    if (xy[0] !== ".") staged.push({ file, status: xy[0] });
    if (xy[1] !== ".") unstaged.push({ file, status: xy[1] });
  }
  return { branch, staged, unstaged, untracked };
}
async function gLog(rel: string) {
  const d = resolveAndValidate(rel);
  const { stdout } = await exec("git", ["log","--max-count=10","--format=%h %s (%cr)"], { cwd: d });
  return stdout.trim().split("\n").filter(Boolean);
}

// ── UI Cards ──
function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

function wsRootCard(list: string[], page: number) {
  const PP = 9, total = Math.ceil(list.length / PP) || 1;
  const slice = list.slice(page * PP, (page + 1) * PP);
  const children: any[] = [CardText(`Select a project to start chatting with Claude Code.\n\n📂 ${getWorkspacesRoot()}`)];
  if (slice.length > 0) {
    for (const row of chunk(slice, 3))
      children.push(Actions(row.map(d => Button({ id: "op", value: d, label: d }))));
  } else children.push(CardText("No projects."));
  if (total > 1) {
    const nav: any[] = [];
    if (page > 0) nav.push(Button({ id: "rp", value: `${page-1}`, label: "◀ Prev" }));
    nav.push(Button({ id: "x", value: "x", label: `${page+1}/${total}` }));
    if (page < total - 1) nav.push(Button({ id: "rp", value: `${page+1}`, label: "Next ▶" }));
    children.push(Actions(nav));
  }
  children.push(Actions([Button({ id: "mk", value: ".", label: "+ New Folder" })]));
  return Card({ title: "WORKSPACES", children });
}

function projectCard(name: string) {
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

function ssCard(list: any[], wd: string, sessionMap: Map<string, string>) {
  const children: any[] = [CardText(wd || "(root)")];
  if (list.length === 0) {
    children.push(CardText("No sessions yet."));
  } else {
    const btns = list.slice(0, 6).map((s: any, i: number) => {
      const key = `${i}`;
      sessionMap.set(key, s.sessionId);
      const lb = (s.customTitle || s.summary || s.firstPrompt || "Untitled").slice(0, 24);
      return Button({ id: "rs", value: key, label: `${i+1}. ${lb}` });
    });
    for (const row of chunk(btns, 2)) children.push(Actions(row));
  }
  children.push(Actions([
    Button({ id: "ns", value: ".", label: "New Session", style: "primary" }),
    Button({ id: "up", value: ".", label: "⬅ Back" }),
  ]));
  return Card({ title: "SESSIONS", children });
}

function statusLine(c: Ctx): string {
  const wd = c.workDir || "(none)";
  return `\n\n📍 ${wd} · Send a message to chat`;
}

function chatCard(wd: string, label: string) {
  return `💬 ${wd} — ${label}\n\nSend any message to chat.\n\n📍 ${wd} · /stop /new /start`;
}

function gitCard(st: any, _wd: string) {
  const lines = [`Branch: ${st.branch}`];
  const total = st.staged.length + st.unstaged.length + st.untracked.length;
  if (st.staged.length) {
    lines.push(`\nSTAGED (${st.staged.length}):`);
    st.staged.slice(0,8).forEach((f:any) => lines.push(`  + ${f.file}`));
    if (st.staged.length > 8) lines.push(`  …+${st.staged.length-8}`);
  }
  if (st.unstaged.length) {
    lines.push(`\nCHANGES (${st.unstaged.length}):`);
    st.unstaged.slice(0,8).forEach((f:any) => lines.push(`  ~ ${f.file}`));
    if (st.unstaged.length > 8) lines.push(`  …+${st.unstaged.length-8}`);
  }
  if (st.untracked.length) {
    lines.push(`\nUNTRACKED (${st.untracked.length}):`);
    st.untracked.slice(0,8).forEach((f:any) => lines.push(`  ? ${f.file}`));
    if (st.untracked.length > 8) lines.push(`  …+${st.untracked.length-8}`);
  }
  if (total === 0) lines.push("\n✓ Clean");
  const children: any[] = [CardText(lines.join("\n"))];

  // Stage / unstage / commit row
  const row1: any[] = [];
  if (st.unstaged.length + st.untracked.length > 0) row1.push(Button({ id: "ga", value: "sa", label: "Stage All", style: "primary" }));
  if (st.staged.length > 0) row1.push(Button({ id: "ga", value: "ua", label: "Unstage" }));
  if (st.staged.length > 0) row1.push(Button({ id: "ga", value: "cm", label: "Commit" }));
  if (row1.length) children.push(Actions(row1));

  // Auto-generate commit (staged changes exist)
  if (st.staged.length > 0) {
    children.push(Actions([Button({ id: "ga", value: "ac", label: "✨ Auto Commit" })]));
  }

  // Pull / Push / Log
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

function logCard(commits: string[]) {
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

// ── Tool summary ──
function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== "object") return name;
  const i = input as Record<string, any>;
  switch (name) {
    case "Read": return `Read: ${i.file_path?.split("/").pop() || ""}`;
    case "Write": return `Write: ${i.file_path?.split("/").pop() || ""}`;
    case "Edit": return `Edit: ${i.file_path?.split("/").pop() || ""}`;
    case "Bash": { const cmd = (i.command || "").slice(0, 40); return `Bash: ${cmd}${(i.command||"").length > 40 ? "…" : ""}`; }
    case "Glob": return `Glob: ${i.pattern || ""}`;
    case "Grep": return `Grep: ${(i.pattern || "").slice(0, 30)}`;
    case "Agent": return `Agent: ${(i.description || "").slice(0, 30)}`;
    default: return name;
  }
}

// ── Claude streaming ──
async function chat(thread: any, text: string, c: Ctx) {
  if (c.busy) { await thread.post("⏳ Processing… /stop to cancel."); return; }
  c.busy = true;
  const cwd = c.workDir ? resolveAndValidate(c.workDir) : getWorkspacesRoot();
  const threadId = thread.id;
  const chatId = tgChatId(threadId);
  let mid: string | null = null;
  let lastEdit = 0, dirty = false, assistantText = "", currentStatus = "⏳ Thinking…";

  mid = await tgSend(chatId, currentStatus);

  function buildDisplay(): string {
    const parts: string[] = [];
    if (assistantText) parts.push(assistantText);
    if (currentStatus) parts.push(currentStatus);
    return parts.join("\n\n") || "⏳ …";
  }

  async function flush(force = false) {
    const now = Date.now();
    if (!force && now - lastEdit < 800) { dirty = true; return; }
    dirty = false; lastEdit = now;
    try {
      const raw = buildDisplay();
      const html = mdToTgHtml(trunc(raw));
      if (!mid) {
        mid = await tgSend(chatId, html);
      } else {
        await tgEdit(chatId, mid, html);
      }
    } catch (err) {
      logger.error(`[bot] flush error: ${err}`);
    }
  }

  const flushInterval = setInterval(() => { if (dirty) flush(true); }, 1000);

  return new Promise<void>((done) => {
    runQuery({ prompt: text, resumeId: c.sessionId, cwd }, {
      onMessage: async (msg: SDKMessage) => {
        if (!("type" in msg)) return;
        const m = msg as any;
        if (m.session_id) c.sessionId = m.session_id;

        if (m.type === "assistant" && m.message?.content) {
          for (const block of m.message.content) {
            if (block.type === "thinking") { currentStatus = "⏳ Thinking…"; flush(); }
            else if (block.type === "text" && block.text) { assistantText = block.text; flush(); }
            else if (block.type === "tool_use") { currentStatus = `⚙️ ${toolSummary(block.name, block.input)}`; flush(true); }
          }
          return;
        }
        if (m.type === "user" && m.message?.content) {
          for (const block of m.message.content) {
            if (block.type === "tool_result") { currentStatus = "⏳ Thinking…"; flush(); }
          }
          return;
        }
        if (m.type === "content_block_delta" || m.type === "stream_event") {
          if (m.delta?.text) { assistantText += m.delta.text; flush(); }
          return;
        }
        if (m.type === "result") {
          if (m.result) assistantText = m.result;
          currentStatus = "";
          flush(true);
          return;
        }
      },
      onToolApproval: async (toolName: string, input: unknown, opts: { toolUseID: string }): Promise<ToolApprovalResult> => {
        const summary = toolSummary(toolName, input);
        currentStatus = `🔐 Approval: ${summary}`;
        await flush(true);
        try {
          await thread.post(Card({
            title: `🔐 ${toolName}`,
            children: [
              CardText(summary),
              Actions([
                Button({ id: "ta", value: `a:${opts.toolUseID.slice(0,50)}`, label: "✅ Allow", style: "primary" }),
                Button({ id: "ta", value: `d:${opts.toolUseID.slice(0,50)}`, label: "❌ Deny" }),
              ]),
            ],
          }));
        } catch {}
        return new Promise((resolve) => {
          c.pendingApprovals.set(opts.toolUseID, { resolve, input: input as Record<string, unknown> });
        });
      },
      onDone: async () => {
        clearInterval(flushInterval);
        currentStatus = "";
        c.busy = false; c.abort = null;
        await new Promise(r => setTimeout(r, 50));
        // Append workspace status to final message
        assistantText = (assistantText || "_(no response)_") + statusLine(c);
        await flush(true);
        done();
      },
      onError: async (err: Error) => {
        c.busy = false; c.abort = null; clearInterval(flushInterval);
        logger.error(`[bot] ${err.message}`);
        currentStatus = ""; assistantText += `\n\n⚠️ ${err.message}`;
        await flush(true); done();
      },
    }).then(ac => { c.abort = ac; }).catch(e => {
      c.busy = false; clearInterval(flushInterval);
      thread.post(`⚠️ ${e.message}`).catch(()=>{}); done();
    });
  });
}

// ── Route messages ──
async function route(thread: any, text: string, tid: string) {
  const c = ctx(tid);
  const t = text.trim();
  const cmd = t.split(/\s+/)[0].toLowerCase().replace(/@\S+$/, "");

  if (c.awaiting === "mkdir") {
    c.awaiting = null;
    const name = t.replace(/[/\\]/g, "").trim();
    if (!name) { await thread.post("Cancelled."); return; }
    const np = c.workDir ? `${c.workDir}/${name}` : name;
    try {
      await fsP.mkdir(resolveAndValidate(np), { recursive: true });
      await thread.post(`✅ Created ${np}`);
      await thread.post(wsRootCard(await dirs(c.workDir), 0));
    } catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }
  if (c.awaiting === "commit") {
    c.awaiting = null;
    if (!t) { await thread.post("Cancelled."); return; }
    try {
      await exec("git", ["commit", "-m", t], { cwd: resolveAndValidate(c.workDir) });
      await thread.post(`✅ ${t}`);
      await thread.post(gitCard(await gStatus(c.workDir), c.workDir));
    } catch (e: any) { await thread.post(`❌ ${e.stderr || e.message}`); }
    return;
  }

  if (cmd === "/start") {
    c.awaiting = null;
    try {
      if (cmd === "/start") {
        await thread.post("👋 *AEBClawd* — Claude Code from anywhere.\n\nPick a project below, then choose New Chat to start a conversation or Sessions to resume one.");
      }
      await thread.post(wsRootCard(await dirs(""), 0));
    } catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }
  if (cmd === "/new") { c.sessionId = undefined; c.awaiting = null; await thread.post(`✨ New conversation.\n\n📍 ${c.workDir || "(no workspace)"} · Send a message to start`); return; }
  if (cmd === "/stop") {
    if (c.abort) { c.abort.abort(); c.abort = null; c.busy = false; await thread.post("🛑 Stopped."); }
    else await thread.post("Nothing to stop.");
    return;
  }
  if (cmd === "/sessions") {
    try { await thread.post(ssCard(await fetchSessions(c.workDir), c.workDir, c.sessMap)); }
    catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }
  if (cmd === "/git") {
    if (!c.workDir) { await thread.post("Select a workspace first. /start"); return; }
    try { await thread.post(gitCard(await gStatus(c.workDir), c.workDir)); }
    catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }

  if (!c.workDir && !c.sessionId) {
    try { await thread.post(wsRootCard(await dirs(""), 0)); }
    catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }

  logger.info(`[bot] "${t.slice(0,60)}" wd=${c.workDir}`);
  await chat(thread, t, c);
}

// ── Edit helper ──
async function edit(e: any, card: any) {
  try {
    const adapter = e.thread.adapter ?? e.adapter;
    const threadId = e.threadId ?? e.thread?.id;
    const msgId = e.messageId;
    if (adapter && threadId && msgId) {
      await adapter.editMessage(threadId, msgId, card);
    } else { await e.thread.post(card); }
  } catch { await e.thread.post(card); }
}

// ── Register handlers ──
const handle = async (thread: any, message: any) => {
  const t = message?.text?.trim(); if (!t) return;
  await thread.subscribe();
  await route(thread, t, thread.id ?? "");
};

bot.onDirectMessage(handle);
bot.onNewMention(async (thread: any, message: any) => {
  const t = message?.text?.trim();
  if (!t) { try { await thread.post(wsRootCard(await dirs(""), 0)); } catch {} return; }
  await thread.subscribe();
  await route(thread, t, thread.id ?? "");
});
bot.onSubscribedMessage(async (thread: any, message: any) => {
  const t = message?.text?.trim(); if (!t) return;
  await route(thread, t, thread.id ?? "");
});
bot.onNewMessage(/^\//, handle);

// ── Button handlers ──

bot.onAction("op", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  c.workDir = e.value ?? ""; c.awaiting = null;
  try { await e.thread.post(projectCard(c.workDir)); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("rp", async (e: any) => {
  if (!e.thread) return;
  try { await edit(e, wsRootCard(await dirs(""), parseInt(e.value)||0)); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("bk", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? ""); c.workDir = "";
  try { await edit(e, wsRootCard(await dirs(""), 0)); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("cd", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  c.workDir = c.workDir ? `${c.workDir}/${e.value ?? ""}` : (e.value ?? "");
  c.awaiting = null;
  try { await edit(e, projectCard(c.workDir)); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("up", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  if (!c.workDir) { await edit(e, wsRootCard(await dirs(""), 0)); return; }
  const parent = pathMod.dirname(c.workDir);
  if (parent === "." || parent === c.workDir) {
    try { await edit(e, projectCard(c.workDir)); }
    catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
  } else {
    c.workDir = parent;
    try { await edit(e, projectCard(c.workDir)); }
    catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
  }
});

bot.onAction("mk", async (e: any) => {
  if (!e.thread) return;
  ctx(e.thread.id ?? "").awaiting = "mkdir";
  await e.thread.post("Type the folder name:");
});

bot.onAction("ss", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  try { await edit(e, ssCard(await fetchSessions(c.workDir), c.workDir, c.sessMap)); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("rs", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  const sid = c.sessMap.get(e.value ?? "") ?? e.value ?? "";
  c.sessionId = sid;
  await edit(e, chatCard(c.workDir, `Resumed: ${sid.slice(0,8)}…`));
});

bot.onAction("ns", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  c.sessionId = undefined;
  await edit(e, chatCard(c.workDir, "New session"));
});

bot.onAction("gt", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  try { await edit(e, gitCard(await gStatus(c.workDir), c.workDir)); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("ga", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  const act = e.value ?? "";
  try {
    const d = resolveAndValidate(c.workDir);
    if (act === "sa") { await exec("git",["add","."],{cwd:d}); }
    else if (act === "ua") { await exec("git",["reset","HEAD","."],{cwd:d}); }
    else if (act === "cm") { c.awaiting = "commit"; await e.thread.post("Type commit message:"); return; }
    else if (act === "lg") { await edit(e, logCard(await gLog(c.workDir))); return; }
    else if (act === "pl") {
      await e.thread.post("⏳ Pulling…");
      const { stdout, stderr } = await exec("git",["pull"],{cwd:d});
      await e.thread.post(`✅ ${(stdout+stderr).trim() || "Up to date"}`);
    }
    else if (act === "ps") {
      await e.thread.post("⏳ Pushing…");
      let hasUp = true;
      try { await exec("git",["rev-parse","--abbrev-ref","@{u}"],{cwd:d}); } catch { hasUp = false; }
      const br = (await exec("git",["rev-parse","--abbrev-ref","HEAD"],{cwd:d})).stdout.trim();
      const args = hasUp ? ["push"] : ["push","-u","origin",br];
      const { stdout, stderr } = await exec("git",args,{cwd:d});
      await e.thread.post(`✅ ${(stdout+stderr).trim() || "Pushed"}`);
    }
    else if (act === "ac") {
      // Auto-generate commit via Claude
      await chat(e.thread, "Create a git commit for the currently staged changes. Write a good conventional commit message yourself and commit it directly. Do not ask me for the message, just do it.", c);
      return;
    }
    await edit(e, gitCard(await gStatus(c.workDir), c.workDir));
  } catch (err: any) { await e.thread.post(`❌ ${err.stderr || err.message}`); }
});

bot.onAction("ta", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  const val = e.value ?? "";
  const colon = val.indexOf(":");
  const decision = val.slice(0, colon);
  const toolUseId = val.slice(colon + 1);
  const pending = c.pendingApprovals.get(toolUseId);
  if (!pending) { try { await edit(e, "⚠️ Expired."); } catch {} return; }
  c.pendingApprovals.delete(toolUseId);
  if (decision === "a") {
    pending.resolve({ behavior: "allow", updatedInput: pending.input });
    try { await edit(e, "✅ Allowed"); } catch {}
  } else {
    pending.resolve({ behavior: "deny", message: "Denied" });
    try { await edit(e, "❌ Denied"); } catch {}
  }
});

bot.onAction("x", async () => {});
bot.onAction(async (e: any) => { logger.info(`[bot] action: ${e.actionId}=${e.value}`); });

// ── Start ──
logger.info("[bot] Adapters: " + Object.keys(adapters).join(", "));
bot.initialize().then(() => logger.info("[bot] Ready")).catch(e => logger.error(`[bot] ${e.message}`));
