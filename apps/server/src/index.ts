import { createServer } from "http";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { setupWebSocketServer } from "./lib/session.js";

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

setupWebSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});
