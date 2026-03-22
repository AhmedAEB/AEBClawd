import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createGitHubAdapter } from "@chat-adapter/github";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";
import pathMod from "node:path";
import { logger, resolveAndValidate, getWorkspacesRoot } from "@aebclawd/core";
import { ctx } from "./context.js";
import { dirs, gStatus, gLog, exec } from "./helpers.js";
import { wsRootCard, projectCard, ssCard, chatCard, gitCard, logCard } from "./cards.js";
import { chat } from "./chat.js";
import { route } from "./commands.js";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

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
  logger.error("[bot] No adapters configured.");
  process.exit(1);
}

const bot = new Chat({
  userName: process.env.BOT_USERNAME || "aebclawd",
  adapters, state: createMemoryState(), logger: "info",
  onLockConflict: "force", streamingUpdateIntervalMs: 600,
  fallbackStreamingPlaceholderText: null,
});

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

async function fetchSessions(rel: string) {
  return listSessions({ dir: rel ? resolveAndValidate(rel) : getWorkspacesRoot(), limit: 20 });
}

// ── Message handlers ──
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
  try { await edit(e, wsRootCard(await dirs(""), parseInt(e.value) || 0)); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("bk", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? ""); c.workDir = ""; c.sessionId = undefined;
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
  await edit(e, chatCard(c.workDir, `Resumed: ${sid.slice(0, 8)}…`));
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
  try { await edit(e, gitCard(await gStatus(c.workDir))); }
  catch (err: any) { await e.thread.post(`❌ ${err.message}`); }
});

bot.onAction("ga", async (e: any) => {
  if (!e.thread) return;
  const c = ctx(e.thread.id ?? "");
  const act = e.value ?? "";
  try {
    const d = resolveAndValidate(c.workDir);
    if (act === "sa") { await exec("git", ["add", "."], { cwd: d }); }
    else if (act === "ua") { await exec("git", ["reset", "HEAD", "."], { cwd: d }); }
    else if (act === "cm") { c.awaiting = "commit"; await e.thread.post("Type commit message:"); return; }
    else if (act === "lg") { await edit(e, logCard(await gLog(c.workDir))); return; }
    else if (act === "pl") {
      await e.thread.post("⏳ Pulling…");
      const { stdout, stderr } = await exec("git", ["pull"], { cwd: d });
      await e.thread.post(`✅ ${(stdout + stderr).trim() || "Up to date"}`);
    }
    else if (act === "ps") {
      await e.thread.post("⏳ Pushing…");
      let hasUp = true;
      try { await exec("git", ["rev-parse", "--abbrev-ref", "@{u}"], { cwd: d }); } catch { hasUp = false; }
      const br = (await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: d })).stdout.trim();
      const args = hasUp ? ["push"] : ["push", "-u", "origin", br];
      const { stdout, stderr } = await exec("git", args, { cwd: d });
      await e.thread.post(`✅ ${(stdout + stderr).trim() || "Pushed"}`);
    }
    else if (act === "ac") {
      await chat(e.thread, "Create a git commit for the currently staged changes. Write a good conventional commit message yourself and commit it directly. Do not ask me for the message, just do it.", c);
      return;
    }
    await edit(e, gitCard(await gStatus(c.workDir)));
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
