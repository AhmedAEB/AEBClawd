import { serve } from "@hono/node-server";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import sessions from "./routes/sessions.js";
import stream from "./routes/stream.js";
import filesystem from "./routes/filesystem.js";

const app = new Hono();

app.use("*", cors());

app.route("/api/sessions", sessions);
app.route("/api/stream", stream);
app.route("/api/filesystem", filesystem);

app.get("/api/workspace-root", (c) =>
  c.json({ root: path.basename(path.resolve(env.WORKSPACES_ROOT)) }),
);

app.get("/", (c) => c.json({ status: "ok" }));

serve({ fetch: app.fetch, port: env.PORT }, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});
