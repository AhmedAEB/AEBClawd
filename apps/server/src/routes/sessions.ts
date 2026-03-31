import { Hono } from "hono";
import { listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { resolveAndValidate, getWorkspacesRoot } from "../lib/paths.js";

const sessions = new Hono();

sessions.get("/", async (c) => {
  const dirParam = c.req.query("dir");
  let dir: string;

  if (dirParam) {
    try {
      dir = resolveAndValidate(dirParam);
    } catch {
      return c.json({ error: "Path is outside workspace root" }, 403);
    }
  } else {
    dir = getWorkspacesRoot();
  }

  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const result = await listSessions({ dir, limit });
  return c.json(result);
});

sessions.get("/:id/messages", async (c) => {
  const sessionId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") ?? "200", 10);

  // Fetch all messages and return the last `limit` so page refreshes show recent messages
  const all = await getSessionMessages(sessionId, {});
  return c.json(all.slice(-limit));
});

export default sessions;
