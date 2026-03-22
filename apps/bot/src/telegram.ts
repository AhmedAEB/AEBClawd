import { logger } from "@aebclawd/core";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

export function mdToTgHtml(md: string): string {
  let s = md;
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/__(.+?)__/g, "<b>$1</b>");
  s = s.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
  s = s.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");
  s = s.replace(/~~(.+?)~~/g, "<s>$1</s>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(\|.+\|[ \t]*\n\|[-| :]+\|[ \t]*\n(?:\|.+\|[ \t]*\n?)+)/g, (table) => {
    return `<pre>${table.trim()}</pre>`;
  });
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  return s;
}

export async function tgEdit(chatId: string, messageId: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: parseInt(messageId, 10), text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json() as any;
  if (!j.ok && j.description?.includes("parse")) {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: parseInt(messageId, 10), text: text.replace(/<[^>]+>/g, ""), disable_web_page_preview: true }),
    }).catch(() => {});
  }
}

export async function tgSend(chatId: string, text: string): Promise<string | null> {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json() as any;
  if (!j.ok && j.description?.includes("parse")) {
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

export function tgChatId(threadId: string): string {
  const parts = threadId.split(":");
  return parts[1] ?? parts[0];
}
