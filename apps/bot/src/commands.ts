import fsP from "node:fs/promises";
import { logger, resolveAndValidate, getWorkspacesRoot } from "@aebclawd/core";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { ctx } from "./context.js";
import { dirs, gStatus, exec } from "./helpers.js";
import { wsRootCard, ssCard, gitCard } from "./cards.js";
import { chat } from "./chat.js";

async function fetchSessions(rel: string) {
  return listSessions({ dir: rel ? resolveAndValidate(rel) : getWorkspacesRoot(), limit: 20 });
}

export async function route(thread: any, text: string, tid: string) {
  const c = ctx(tid);
  const t = text.trim();
  const cmd = t.split(/\s+/)[0].toLowerCase().replace(/@\S+$/, "");

  // Awaiting input
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
      await thread.post(gitCard(await gStatus(c.workDir)));
    } catch (e: any) { await thread.post(`❌ ${e.stderr || e.message}`); }
    return;
  }

  // Commands
  if (cmd === "/start") {
    c.awaiting = null; c.sessionId = undefined; c.workDir = "";
    try {
      await thread.post("👋 *AEBClawd* — Claude Code from anywhere.\n\nPick a project below, then choose New Chat to start a conversation or Sessions to resume one.");
      await thread.post(wsRootCard(await dirs(""), 0));
    } catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }
  if (cmd === "/new") {
    c.sessionId = undefined; c.awaiting = null;
    await thread.post(`✨ New conversation.\n\n📍 ${c.workDir || "(no workspace)"} · Send a message to start`);
    return;
  }
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
    try { await thread.post(gitCard(await gStatus(c.workDir))); }
    catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }

  // No workspace → show workspace browser
  if (!c.workDir && !c.sessionId) {
    try { await thread.post(wsRootCard(await dirs(""), 0)); }
    catch (e: any) { await thread.post(`❌ ${e.message}`); }
    return;
  }

  // Chat with Claude
  logger.info(`[bot] "${t.slice(0, 60)}" wd=${c.workDir}`);
  await chat(thread, t, c);
}
