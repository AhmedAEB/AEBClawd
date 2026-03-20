import { Hono } from "hono";
import { listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const sessions = new Hono();

sessions.get("/", async (c) => {
  const dir = c.req.query("dir");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const result = await listSessions({ dir, limit });
  return c.json(result);
});

sessions.get("/:id/messages", async (c) => {
  const sessionId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") ?? "200", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const messages = await getSessionMessages(sessionId, { limit, offset });
  return c.json(messages);
});

export default sessions;
