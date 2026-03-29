import type { UpgradeWebSocket } from "hono/ws";
import { spawn as ptySpawn } from "node-pty";
import { resolveAndValidate } from "../lib/paths.js";
import { logger } from "../lib/logger.js";

/**
 * WebSocket-based terminal using node-pty.
 * Client sends JSON { type: "init", workDir: "relative/path", cols?: number, rows?: number }
 * then raw text for stdin. Server sends raw text back for stdout/stderr.
 */
export function createTerminalHandler(upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket(() => {
    let pty: ReturnType<typeof ptySpawn> | null = null;

    return {
      onOpen() {
        logger.info("[terminal-ws] Connection opened");
      },

      onMessage(event: MessageEvent, ws: any) {
        const raw = typeof event.data === "string" ? event.data : String(event.data);

        // If no PTY yet, expect an init message
        if (!pty) {
          try {
            const msg = JSON.parse(raw);
            if (msg.type === "init") {
              const cwd = resolveAndValidate(msg.workDir || "");
              const cols = msg.cols || 80;
              const rows = msg.rows || 24;

              pty = ptySpawn("/bin/bash", [], {
                name: "xterm-256color",
                cols,
                rows,
                cwd,
                env: {
                  ...process.env,
                  TERM: "xterm-256color",
                  COLORTERM: "truecolor",
                } as Record<string, string>,
              });

              pty.onData((data: string) => {
                try {
                  ws.send(data);
                } catch {}
              });

              pty.onExit(({ exitCode }: { exitCode: number }) => {
                logger.info(`[terminal-ws] PTY exited with code ${exitCode}`);
                try {
                  ws.send(JSON.stringify({ type: "exit", code: exitCode }));
                  ws.close();
                } catch {}
                pty = null;
              });

              logger.info(`[terminal-ws] PTY spawned in ${cwd} (${cols}x${rows})`);
            }
          } catch (err) {
            logger.error(`[terminal-ws] Init error: ${err}`);
            ws.send(JSON.stringify({ type: "error", message: "Invalid init message" }));
          }
          return;
        }

        // If PTY is running, check for resize or send as stdin
        try {
          const msg = JSON.parse(raw);
          if (msg.type === "resize" && msg.cols && msg.rows) {
            pty.resize(msg.cols, msg.rows);
            return;
          }
        } catch {
          // Not JSON — treat as raw input
        }

        pty.write(raw);
      },

      onClose() {
        if (pty) {
          pty.kill();
          pty = null;
        }
        logger.info("[terminal-ws] Connection closed");
      },

      onError() {
        if (pty) {
          pty.kill();
          pty = null;
        }
        logger.error("[terminal-ws] WebSocket error");
      },
    };
  });
}
