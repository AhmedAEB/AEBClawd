import { logger, runQuery, resolveAndValidate, getWorkspacesRoot } from "@aebclawd/core";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ToolApprovalResult } from "@aebclawd/core";
import type { Ctx } from "./context.js";
import { trunc, toolSummary } from "./helpers.js";
import { mdToTgHtml, tgSend, tgEdit, tgChatId } from "./telegram.js";
import { statusLine, approvalCard } from "./cards.js";

export async function chat(thread: any, text: string, c: Ctx) {
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
      const html = mdToTgHtml(trunc(buildDisplay()));
      if (!mid) { mid = await tgSend(chatId, html); }
      else { await tgEdit(chatId, mid, html); }
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
        try { await thread.post(approvalCard(toolName, summary, opts.toolUseID)); } catch {}
        return new Promise((resolve) => {
          c.pendingApprovals.set(opts.toolUseID, { resolve, input: input as Record<string, unknown> });
        });
      },

      onDone: async () => {
        clearInterval(flushInterval);
        currentStatus = "";
        c.busy = false; c.abort = null;
        await new Promise(r => setTimeout(r, 50));
        assistantText = (assistantText || "_(no response)_") + statusLine(c);
        await flush(true);
        done();
      },

      onError: async (err: Error) => {
        c.busy = false; c.abort = null; clearInterval(flushInterval);
        logger.error(`[bot] ${err.message}`);
        // If session not found, clear it so next message starts fresh
        if (err.message.includes("No conversation found")) {
          c.sessionId = undefined;
        }
        currentStatus = ""; assistantText += `\n\n⚠️ ${err.message}`;
        await flush(true); done();
      },
    }).then(ac => { c.abort = ac; }).catch(e => {
      c.busy = false; clearInterval(flushInterval);
      if (String(e.message).includes("No conversation found")) {
        c.sessionId = undefined;
      }
      thread.post(`⚠️ ${e.message}`).catch(() => {}); done();
    });
  });
}
