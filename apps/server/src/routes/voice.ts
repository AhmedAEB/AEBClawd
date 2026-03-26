import type { UpgradeWebSocket } from "hono/ws";
import { logger } from "../lib/logger.js";
import {
  createVoiceSession,
  getVoiceSession,
  deleteVoiceSession,
} from "../lib/voice-session.js";
import { runVoicePipeline } from "../lib/voice-pipeline.js";
import type { ClientVoiceMessage } from "../lib/voice-types.js";

/**
 * Create the WebSocket handler for voice mode.
 * Returns a Hono handler (not a sub-app) to be mounted directly on the root app.
 */
export function createVoiceHandler(upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket(() => {
    let clientId: string | null = null;

    return {
      onOpen(_event: Event, _ws: unknown) {
        logger.info("[voice-ws] Connection opened");
      },

      onMessage(event: MessageEvent, ws: any) {
        // Binary frame = audio data
        if (event.data instanceof ArrayBuffer || Buffer.isBuffer(event.data)) {
          if (!clientId) return;
          const session = getVoiceSession(clientId);
          if (!session) return;

          const chunk = Buffer.isBuffer(event.data)
            ? event.data
            : Buffer.from(event.data);

          if (session.mode === "call") {
            // Call mode: binary = complete VAD utterance → run pipeline immediately
            logger.info(`[voice-ws] Call mode: received ${chunk.byteLength} bytes of audio`);
            session.audioChunks = [chunk];
            ws.send(JSON.stringify({ type: "state", state: "thinking" }));
            runVoicePipeline(session, ws).catch((err) => {
              logger.error(`[voice-ws] Pipeline error: ${err.message}`);
              try { ws.send(JSON.stringify({ type: "error", message: err.message })); } catch {}
              try { ws.send(JSON.stringify({ type: "state", state: "listening" })); } catch {}
            });
          } else {
            // Voice mode: accumulate chunks for PTT
            session.audioChunks.push(chunk);
          }
          return;
        }

        // JSON message
        let msg: ClientVoiceMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        switch (msg.type) {
          case "start_call": {
            clientId = msg.clientId;
            const session = createVoiceSession(
              msg.clientId,
              msg.workDir,
              msg.model,
              msg.sessionId,
              msg.mode || "voice",
            );
            ws.send(
              JSON.stringify({
                type: "call_started",
                sessionId: session.sessionId,
              }),
            );
            ws.send(
              JSON.stringify({ type: "state", state: "listening" }),
            );
            logger.info(`[voice-ws] Call started for client ${clientId}`);
            break;
          }

          case "ptt_start": {
            if (!clientId) return;
            const session = getVoiceSession(clientId);
            if (session) {
              session.audioChunks = [];
            }
            break;
          }

          case "ptt_end": {
            if (!clientId) return;
            const session = getVoiceSession(clientId);
            if (!session) return;

            ws.send(JSON.stringify({ type: "state", state: "thinking" }));

            runVoicePipeline(session, ws).catch((err) => {
              logger.error(`[voice-ws] Pipeline error: ${err.message}`);
              try { ws.send(JSON.stringify({ type: "error", message: err.message })); } catch {}
              try { ws.send(JSON.stringify({ type: "state", state: "listening" })); } catch {}
            });
            break;
          }

          case "ptt_transcript": {
            if (!clientId) return;
            const session = getVoiceSession(clientId);
            if (!session) return;

            ws.send(JSON.stringify({ type: "state", state: "thinking" }));

            runVoicePipeline(session, ws, msg.text).catch((err) => {
              logger.error(`[voice-ws] Pipeline error: ${err.message}`);
              ws.send(
                JSON.stringify({ type: "error", message: err.message }),
              );
              ws.send(
                JSON.stringify({ type: "state", state: "listening" }),
              );
            });
            break;
          }

          case "text_input": {
            if (!clientId) return;
            const session = getVoiceSession(clientId);
            if (!session) return;

            ws.send(JSON.stringify({ type: "state", state: "thinking" }));

            runVoicePipeline(session, ws, msg.text).catch((err) => {
              logger.error(`[voice-ws] Pipeline error: ${err.message}`);
              ws.send(
                JSON.stringify({ type: "error", message: err.message }),
              );
              ws.send(
                JSON.stringify({ type: "state", state: "listening" }),
              );
            });
            break;
          }

          case "mute_tts": {
            if (!clientId) return;
            const session = getVoiceSession(clientId);
            if (session) session.ttsMuted = true;
            break;
          }

          case "unmute_tts": {
            if (!clientId) return;
            const session = getVoiceSession(clientId);
            if (session) session.ttsMuted = false;
            break;
          }

          case "end_call": {
            if (clientId) {
              deleteVoiceSession(clientId);
              try { ws.send(JSON.stringify({ type: "call_ended" })); } catch {}
              logger.info(`[voice-ws] Call ended for client ${clientId}`);
              clientId = null;
            }
            break;
          }
        }
      },

      onClose() {
        if (clientId) {
          deleteVoiceSession(clientId);
          logger.info(`[voice-ws] Connection closed for client ${clientId}`);
          clientId = null;
        }
      },

      onError(event: Event) {
        logger.error(`[voice-ws] WebSocket error event`);
        if (clientId) {
          deleteVoiceSession(clientId);
          clientId = null;
        }
      },
    };
  });
}
