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

/** Send a typed JSON message over WS. */
function sendJson(ws: WSContext, msg: ServerVoiceMessage): void {
  ws.send(JSON.stringify(msg));
}

/**
 * Run the full voice pipeline for a single turn:
 *   audio/transcript → STT → Claude → sentence buffer → TTS → audio back
 */
export async function runVoicePipeline(
  session: VoiceSession,
  ws: WSContext,
  clientTranscript?: string,
): Promise<void> {
  // ── Step 1: Get transcript ──────────────────────────────────────
  let transcript: string | null = null;

  // Try server-side STT first (if audio is available and STT service configured)
  if (session.audioChunks.length > 0) {
    const audioBuffer = Buffer.concat(session.audioChunks);
    session.audioChunks = [];

    transcript = await transcribe(audioBuffer);
  }

  // Fall back to client-provided transcript (mock mode)
  if (!transcript) {
    transcript = clientTranscript || null;
  }

  if (!transcript || transcript.trim().length === 0) {
    sendJson(ws, { type: "error", message: "No STT service available. Use the text input to send a message during the call, or start the STT Docker container." });
    sendJson(ws, { type: "state", state: "listening" });
    updateVoiceState(session.clientId, "listening");
    return;
  }

  // Send transcript to client for display
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
  let firstTokenReceived = false;

  const abortController = await runQuery(
    {
      prompt: transcript,
      resumeId: session.sessionId || undefined,
      cwd,
      model: session.model || undefined,
    },
    {
      onMessage: (message: SDKMessage) => {
        // Track session ID from Claude
        if ("session_id" in message && message.session_id) {
          session.sessionId = message.session_id;
        }

        // Extract text tokens for streaming display + TTS buffering
        const textContent = extractText(message);
        if (textContent) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            sendJson(ws, { type: "state", state: "speaking" });
            updateVoiceState(session.clientId, "speaking");
          }

          sendJson(ws, { type: "claude_text", text: textContent, done: false });

          // Buffer for TTS
          const sentence = sentenceBuffer.addToken(textContent);
          if (sentence) {
            dispatchTts(ws, session, sentence);
          }
        }
      },

      onToolApproval: async (toolName, input, opts) => {
        // Auto-allow tools in voice mode for Phase 1
        // Tool approval UI is on the SSE channel — voice skips it
        logger.info(`[voice-pipeline] Auto-allowing tool: ${toolName}`);
        return { behavior: "allow", updatedInput: input as Record<string, unknown> };
      },

      onDone: () => {
        // Flush remaining sentence buffer
        const remaining = sentenceBuffer.flush();
        if (remaining) {
          dispatchTts(ws, session, remaining);
        }

        sendJson(ws, { type: "claude_text", text: "", done: true });
        sendJson(ws, { type: "state", state: "listening" });
        updateVoiceState(session.clientId, "listening");
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
 * Handles both partial stream_event deltas and full assistant messages.
 */
function extractText(message: SDKMessage): string | null {
  const msg = message as any;

  // stream_event with text_delta (partial streaming)
  if (
    msg.type === "stream_event" &&
    msg.event?.type === "content_block_delta" &&
    msg.event?.delta?.type === "text_delta"
  ) {
    return msg.event.delta.text || null;
  }

  return null;
}

/**
 * Dispatch a sentence to TTS and send audio back, or send text-only if no TTS.
 * Runs async (fire-and-forget relative to the Claude stream).
 */
async function dispatchTts(
  ws: WSContext,
  session: VoiceSession,
  text: string,
): Promise<void> {
  if (session.ttsMuted) return;

  try {
    const audioBuffer = await synthesize(text);
    if (audioBuffer) {
      sendJson(ws, { type: "tts_start" });
      // Send audio as binary frame
      ws.send(new Uint8Array(audioBuffer) as unknown as ArrayBuffer);
      sendJson(ws, { type: "tts_end" });
    }
    // If no audio (mock mode), client uses SpeechSynthesis based on claude_text messages
  } catch (err: any) {
    logger.error(`[voice-pipeline] TTS dispatch error: ${err.message}`);
  }
}
