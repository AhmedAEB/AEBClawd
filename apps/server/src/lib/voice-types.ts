export type VoiceCallState = "idle" | "listening" | "thinking" | "speaking";
export type VoiceMode = "voice" | "call";

export interface VoiceSession {
  clientId: string;
  sessionId: string | null;
  state: VoiceCallState;
  mode: VoiceMode;
  audioChunks: Buffer[];
  abortController: AbortController | null;
  pipelineBusy: boolean;
  ttsMuted: boolean;
  workDir: string;
  model: string;
}

// ── Client → Server messages ────────────────────────────────────────

export type ClientVoiceMessage =
  | {
      type: "start_call";
      clientId: string;
      workDir: string;
      model: string;
      sessionId?: string;
      mode?: VoiceMode;
    }
  | { type: "ptt_start" }
  | { type: "ptt_end" }
  | { type: "ptt_transcript"; text: string }
  | { type: "text_input"; text: string }
  | { type: "mute_tts" }
  | { type: "unmute_tts" }
  | { type: "end_call" };

// ── Server → Client messages ────────────────────────────────────────

export type ServerVoiceMessage =
  | { type: "state"; state: VoiceCallState }
  | { type: "transcript_final"; text: string }
  | { type: "claude_text"; text: string; done: boolean }
  | { type: "tts_start" }
  | { type: "tts_end" }
  | { type: "error"; message: string }
  | { type: "call_started"; sessionId?: string }
  | { type: "call_ended" };
