import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  registerClient,
  unregisterClient,
  handlePrompt,
  handleToolApproval,
  handleAbort,
} from "../lib/session.js";

const stream = new Hono();

stream.get("/", (c) => {
  const clientId = c.req.query("clientId");
  if (!clientId) return c.json({ error: "clientId required" }, 400);

  return streamSSE(c, async (s) => {
    registerClient(clientId, (event, data) => {
      s.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
    });

    const keepAlive = setInterval(() => {
      s.writeSSE({ event: "ping", data: "" }).catch(() => {});
    }, 30_000);

    await new Promise<void>((resolve) => {
      s.onAbort(() => {
        clearInterval(keepAlive);
        unregisterClient(clientId);
        resolve();
      });
    });
  });
});

stream.post("/prompt", async (c) => {
  const { clientId, prompt, sessionId, workDir, model } = await c.req.json();
  const ok = await handlePrompt(clientId, prompt, sessionId, workDir, model);
  return ok ? c.json({ ok: true }) : c.json({ error: "client not found" }, 404);
});

stream.post("/tool-approval", async (c) => {
  const { clientId, toolUseId, approved, reason } = await c.req.json();
  handleToolApproval(clientId, toolUseId, approved, reason);
  return c.json({ ok: true });
});

stream.post("/abort", async (c) => {
  const { clientId } = await c.req.json();
  handleAbort(clientId);
  return c.json({ ok: true });
});

export default stream;
