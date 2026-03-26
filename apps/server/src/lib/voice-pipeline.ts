import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { WSContext } from "hono/ws";
import { runQuery } from "./claude.js";
import { resolveAndValidate, getWorkspacesRoot } from "./paths.js";
import { transcribe } from "./stt-client.js";
import { synthesize } from "./tts-client.js";
import { SentenceBuffer } from "./sentence-buffer.js";
import { updateVoiceState } from "./voice-session.js";
import { logger } from "./logger.js";
import type { VoiceSession, ServerVoiceMessage } from "./voice-types.js";

/** Send a typed JSON message over WS, guarding against closed connections. */
function sendJson(ws: WSContext, msg: ServerVoiceMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // WebSocket already closed — ignore
  }
}

/** Send binary data over WS, guarding against closed connections. */
function sendBinary(ws: WSContext, data: Buffer): void {
  try {
    ws.send(new Uint8Array(data) as unknown as ArrayBuffer);
  } catch {
    // WebSocket already closed — ignore
  }
}

/**
 * Run the full voice pipeline for a single turn:
 *   audio/transcript → STT → Claude → sentence buffer → TTS → audio back
 *
 * Guarded by session.pipelineBusy to prevent concurrent invocations.
 * If a new utterance arrives while the pipeline is busy, the previous
 * pipeline is aborted first.
 */
export async function runVoicePipeline(
  session: VoiceSession,
  ws: WSContext,
  clientTranscript?: string,
): Promise<void> {
  // Abort any in-flight pipeline before starting a new one
  if (session.pipelineBusy && session.abortController) {
    logger.info("[voice-pipeline] Aborting previous pipeline for new utterance");
    session.abortController.abort();
  }
  session.pipelineBusy = true;

  try {
    await runPipelineInner(session, ws, clientTranscript);
  } finally {
    session.pipelineBusy = false;
  }
}

async function runPipelineInner(
  session: VoiceSession,
  ws: WSContext,
  clientTranscript?: string,
): Promise<void> {
  // ── Step 1: Get transcript ──────────────────────────────────────
  let transcript: string | null = null;

  if (session.audioChunks.length > 0) {
    const audioBuffer = Buffer.concat(session.audioChunks);
    session.audioChunks = [];

    const mimeType = session.mode === "call" ? "audio/wav" : "audio/webm";
    logger.info(`[voice-pipeline] STT: ${audioBuffer.byteLength} bytes (${mimeType})`);
    transcript = await transcribe(audioBuffer, mimeType);
    if (transcript) {
      logger.info(`[voice-pipeline] STT result: "${transcript.slice(0, 80)}"`);
    }
  }

  // Fall back to client-provided transcript (mock mode)
  if (!transcript) {
    transcript = clientTranscript || null;
  }

  if (!transcript || transcript.trim().length === 0) {
    sendJson(ws, { type: "error", message: "No STT service available. Use the text input or start the STT Docker container." });
    sendJson(ws, { type: "state", state: "listening" });
    updateVoiceState(session.clientId, "listening");
    return;
  }

  sendJson(ws, { type: "transcript_final", text: transcript });

  // ── Step 2: Send to Claude ──────────────────────────────────────
  sendJson(ws, { type: "state", state: "thinking" });
  updateVoiceState(session.clientId, "thinking");

  let cwd: string;
  try {
    cwd = session.workDir ? resolveAndValidate(session.workDir) : getWorkspacesRoot();
  } catch {
    sendJson(ws, { type: "error", message: "Invalid workspace directory" });
    sendJson(ws, { type: "state", state: "listening" });
    updateVoiceState(session.clientId, "listening");
    return;
  }

  const sentenceBuffer = new SentenceBuffer();
  const ttsQueue: Promise<void>[] = [];
  let firstTokenReceived = false;

  // Store abortController on session BEFORE the query starts so it can be aborted
  const abortController = await runQuery(
    {
      prompt: transcript,
      resumeId: session.sessionId || undefined,
      cwd,
      model: session.model || undefined,
    },
    {
      onMessage: (message: SDKMessage) => {
        if ("session_id" in message && message.session_id) {
          session.sessionId = message.session_id;
        }

        const textContent = extractText(message);
        if (textContent) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            sendJson(ws, { type: "state", state: "speaking" });
            updateVoiceState(session.clientId, "speaking");
          }

          sendJson(ws, { type: "claude_text", text: textContent, done: false });

          const sentence = sentenceBuffer.addToken(textContent);
          if (sentence) {
            // Queue TTS sequentially to maintain sentence order
            const ttsPromise = dispatchTts(ws, session, sentence);
            ttsQueue.push(ttsPromise);
          }
        }
      },

      onToolApproval: async (toolName, input) => {
        logger.info(`[voice-pipeline] Auto-allowing tool: ${toolName}`);
        return { behavior: "allow", updatedInput: input as Record<string, unknown> };
      },

      onDone: () => {
        const remaining = sentenceBuffer.flush();
        if (remaining) {
          ttsQueue.push(dispatchTts(ws, session, remaining));
        }

        // Wait for all TTS to finish before signaling completion
        Promise.all(ttsQueue).then(() => {
          sendJson(ws, { type: "claude_text", text: "", done: true });
          sendJson(ws, { type: "state", state: "listening" });
          updateVoiceState(session.clientId, "listening");
        });
      },

      onError: (err) => {
        sendJson(ws, { type: "error", message: err.message });
        sendJson(ws, { type: "state", state: "listening" });
        updateVoiceState(session.clientId, "listening");
      },
    },
  );

  session.abortController = abortController;
}

/**
 * Extract text content from an SDK message.
 */
function extractText(message: SDKMessage): string | null {
  // SDKMessage type doesn't expose stream_event directly, access via index signature
  const msg = message as Record<string, unknown>;

  if (
    msg.type === "stream_event" &&
    typeof msg.event === "object" &&
    msg.event !== null
  ) {
    const event = msg.event as Record<string, unknown>;
    if (
      event.type === "content_block_delta" &&
      typeof event.delta === "object" &&
      event.delta !== null
    ) {
      const delta = event.delta as Record<string, unknown>;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        return delta.text || null;
      }
    }
  }

  return null;
}

/**
 * Dispatch a sentence to TTS and send audio back.
 * Returns a promise that resolves when TTS audio has been sent.
 */
async function dispatchTts(
  ws: WSContext,
  session: VoiceSession,
  text: string,
): Promise<void> {
  if (session.ttsMuted) return;
  if (session.abortController?.signal.aborted) return;

  try {
    const audioBuffer = await synthesize(text);
    if (audioBuffer && !session.abortController?.signal.aborted) {
      sendBinary(ws, audioBuffer);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[voice-pipeline] TTS error: ${message}`);
  }
}
