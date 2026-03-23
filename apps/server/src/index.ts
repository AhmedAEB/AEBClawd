import { existsSync, mkdirSync, symlinkSync, lstatSync, readdirSync, copyFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";

// Persist ~/.claude on a volume so auth tokens survive deploys
if (env.DATA_DIR && existsSync(env.DATA_DIR)) {
  const claudeData = join(env.DATA_DIR, ".claude");
  const claudeHome = join(homedir(), ".claude");
  mkdirSync(claudeData, { recursive: true });
  let needsLink = true;
  try { needsLink = !lstatSync(claudeHome).isSymbolicLink() && !existsSync(claudeHome); } catch {}
  if (needsLink) {
    try { symlinkSync(claudeData, claudeHome); logger.info(`Symlinked ${claudeHome} -> ${claudeData}`); } catch {}
  }
  // Restore ~/.claude.json from backup if missing
  const claudeJson = join(homedir(), ".claude.json");
  if (!existsSync(claudeJson)) {
    const backupsDir = join(claudeData, "backups");
    if (existsSync(backupsDir)) {
      const latest = readdirSync(backupsDir).filter((f) => f.startsWith(".claude.json.backup.")).sort().pop();
      if (latest) { copyFileSync(join(backupsDir, latest), claudeJson); logger.info(`Restored ${claudeJson} from backup`); }
    }
  }
}
import sessions from "./routes/sessions.js";
import stream from "./routes/stream.js";
import filesystem from "./routes/filesystem.js";
import git from "./routes/git.js";
import models from "./routes/models.js";
import { createVoiceHandler } from "./routes/voice.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// WebSocket route MUST be mounted before cors() middleware
app.get("/ws/voice", createVoiceHandler(upgradeWebSocket));

// CORS for HTTP API routes only
app.use("/api/*", cors());

app.route("/api/sessions", sessions);
app.route("/api/stream", stream);
app.route("/api/filesystem", filesystem);
app.route("/api/git", git);
app.route("/api/models", models);

app.get("/health", (c) => c.json({ status: "ok" }));

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, () => {
  logger.info(`Server listening on 0.0.0.0:${env.PORT}`);
});

injectWebSocket(server);
