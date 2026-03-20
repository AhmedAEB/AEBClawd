import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import sessions from "./routes/sessions.js";
import stream from "./routes/stream.js";

const app = new Hono();

app.use("*", cors());

app.route("/api/sessions", sessions);
app.route("/api/stream", stream);

app.get("/", (c) => c.json({ status: "ok" }));

serve({ fetch: app.fetch, port: env.PORT }, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});
