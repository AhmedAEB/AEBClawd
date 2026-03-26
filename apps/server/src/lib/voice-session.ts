import { logger } from "./logger.js";
import type { VoiceSession, VoiceCallState, VoiceMode } from "./voice-types.js";

const voiceSessions = new Map<string, VoiceSession>();

export function createVoiceSession(
  clientId: string,
  workDir: string,
  model: string,
  sessionId?: string,
  mode: VoiceMode = "voice",
): VoiceSession {
  // Clean up existing session for this client if any
  deleteVoiceSession(clientId);

  const session: VoiceSession = {
    clientId,
    sessionId: sessionId || null,
    state: "listening",
    mode,
    audioChunks: [],
    abortController: null,
    pipelineBusy: false,
    ttsMuted: false,
    workDir,
    model,
  };

  voiceSessions.set(clientId, session);
  logger.info(`[voice-session] Created for client ${clientId}`);
  return session;
}

export function getVoiceSession(clientId: string): VoiceSession | undefined {
  return voiceSessions.get(clientId);
}

export function deleteVoiceSession(clientId: string): void {
  const session = voiceSessions.get(clientId);
  if (!session) return;

  if (session.abortController) {
    session.abortController.abort();
  }
  voiceSessions.delete(clientId);
  logger.info(`[voice-session] Deleted for client ${clientId}`);
}

export function updateVoiceState(
  clientId: string,
  state: VoiceCallState,
): void {
  const session = voiceSessions.get(clientId);
  if (session) session.state = state;
}
