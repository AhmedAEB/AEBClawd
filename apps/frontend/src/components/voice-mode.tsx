"use client";

import { createContext, useContext, useState } from "react";
import { useVoice, type VoiceState } from "../hooks/use-voice";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const STATE_LABELS: Record<VoiceState, string> = {
  idle: "",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
};

// ── Shared voice state via context ──────────────────────────────

type VoiceContextValue = ReturnType<typeof useVoice> | null;
const VoiceContext = createContext<VoiceContextValue>(null);

interface VoiceProviderProps {
  clientId: string;
  sessionId: string | null;
  relativePath: string;
  selectedModel: string;
  onVoiceMessage: (text: string, role: "user" | "assistant") => void;
  children: React.ReactNode;
}

/** Wraps children with shared voice state. Place once around the footer area. */
export function VoiceProvider({
  clientId,
  sessionId,
  relativePath,
  selectedModel,
  onVoiceMessage,
  children,
}: VoiceProviderProps) {
  const voice = useVoice({
    apiUrl: API_URL,
    clientId,
    sessionId,
    workDir: relativePath,
    model: selectedModel,
    onVoiceMessage,
  });

  return (
    <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>
  );
}

function useVoiceContext() {
  return useContext(VoiceContext);
}

// ── Inline button (goes in the input row next to Send) ──────────

export function VoiceButton({
  isConnected,
  isStreaming,
}: {
  isConnected: boolean;
  isStreaming: boolean;
}) {
  const voice = useVoiceContext();
  if (!voice) {
    console.warn("[VoiceButton] No voice context — rendered outside VoiceProvider?");
    return null;
  }

  if (voice.isInCall) {
    return (
      <button
        onClick={voice.endCall}
        className="shrink-0 bg-fg px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-void transition-colors hover:bg-fg-2"
        title="End voice mode"
      >
        END
      </button>
    );
  }

  return (
    <button
      onClick={voice.startCall}
      disabled={!isConnected || isStreaming}
      className="shrink-0 p-2 text-fg-3 transition-colors hover:text-fg disabled:opacity-30"
      title="Start voice mode"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-5 w-5"
      >
        <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
        <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
      </svg>
    </button>
  );
}

// ── Call panel (goes above the input area, only when in call) ───

export function VoicePanel() {
  const voice = useVoiceContext();
  const [voiceInput, setVoiceInput] = useState("");
  if (!voice || !voice.isInCall) return null;

  const handleVoiceInputSubmit = () => {
    if (!voiceInput.trim()) return;
    voice.sendText(voiceInput.trim());
    setVoiceInput("");
  };

  return (
    <div className="border-t-2 border-fg bg-void px-6 py-4">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`h-2.5 w-2.5 ${
                voice.state === "listening"
                  ? "animate-pulse-dot bg-fg"
                  : voice.state === "thinking"
                    ? "animate-bounce-dot bg-fg"
                    : voice.state === "speaking"
                      ? "bg-fg"
                      : "border border-fg"
              }`}
            />
            <span className="font-display text-[13px] font-bold uppercase tracking-[0.15em] text-fg">
              {STATE_LABELS[voice.state] || "VOICE MODE"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={voice.ttsMuted ? voice.unmuteTts : voice.muteTts}
              className={`border-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                voice.ttsMuted
                  ? "border-fg bg-fg text-void"
                  : "border-fg text-fg hover:bg-panel-2"
              }`}
            >
              {voice.ttsMuted ? "UNMUTE" : "MUTE"}
            </button>
            <button
              onClick={voice.endCall}
              className="border-2 border-fg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-fg transition-colors hover:bg-fg hover:text-void"
            >
              END
            </button>
          </div>
        </div>

        {/* Transcript */}
        {(voice.transcript || voice.claudeText) && (
          <div className="mb-3 max-h-32 overflow-y-auto border border-edge bg-panel-2 p-3 font-mono text-[12px] leading-relaxed text-fg-2">
            {voice.transcript && (
              <div className="mb-1">
                <span className="mr-2 text-[10px] font-bold uppercase tracking-wider opacity-50">
                  YOU
                </span>
                {voice.transcript}
              </div>
            )}
            {voice.claudeText && (
              <div>
                <span className="mr-2 text-[10px] font-bold uppercase tracking-wider opacity-50">
                  CLAUDE
                </span>
                {voice.claudeText}
                {voice.state === "speaking" && (
                  <span className="animate-pulse-dot ml-0.5 inline-block h-2 w-1 bg-fg align-middle" />
                )}
              </div>
            )}
          </div>
        )}

        {/* Click-to-talk toggle */}
        <button
          onClick={voice.toggleRecording}
          disabled={voice.state === "thinking"}
          className={`w-full select-none py-4 text-center text-[14px] font-bold uppercase tracking-[0.15em] transition-all ${
            voice.isRecording
              ? "bg-fg text-void"
              : voice.state === "thinking"
                ? "cursor-wait border-2 border-fg bg-panel-2 text-fg-3"
                : "border-2 border-fg text-fg hover:bg-fg hover:text-void"
          }`}
        >
          {voice.isRecording ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
                <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
              </svg>
              CLICK TO STOP
            </span>
          ) : voice.state === "thinking" ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-bounce-dot h-1.5 w-1.5 bg-fg" style={{ animationDelay: "0ms" }} />
              <span className="animate-bounce-dot h-1.5 w-1.5 bg-fg" style={{ animationDelay: "160ms" }} />
              <span className="animate-bounce-dot h-1.5 w-1.5 bg-fg" style={{ animationDelay: "320ms" }} />
            </span>
          ) : (
            "CLICK TO TALK"
          )}
        </button>

        {/* Text input for voice pipeline (works in mock mode and during calls) */}
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={voiceInput}
            onChange={(e) => setVoiceInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleVoiceInputSubmit();
              }
            }}
            placeholder="Or type here to talk to Claude..."
            disabled={voice.state === "thinking"}
            className="flex-1 border border-edge bg-void px-3 py-2 font-mono text-[12px] text-fg outline-none placeholder:text-fg-3 focus:border-fg disabled:opacity-30"
          />
          <button
            onClick={handleVoiceInputSubmit}
            disabled={!voiceInput.trim() || voice.state === "thinking"}
            className="border-2 border-fg px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-fg transition-colors hover:bg-fg hover:text-void disabled:opacity-30"
          >
            SAY
          </button>
        </div>
      </div>
    </div>
  );
}

// Keep default export for backwards compat — not used anymore
export default function VoiceMode() {
  return null;
}
