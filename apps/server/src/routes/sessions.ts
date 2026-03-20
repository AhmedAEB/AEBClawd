import { Hono } from "hono";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

const sessions = new Hono();

sessions.get("/", async (c) => {
  const dir = c.req.query("dir");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const result = await listSessions({ dir, limit });
  return c.json(result);
});

export default sessions;
