"use client";

import { createContext, useContext } from "react";
import { useCallMode, type CallState } from "../hooks/use-call-mode";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const STATE_LABELS: Record<CallState, string> = {
  idle: "",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
};

// ── Shared call state via context ───────────────────────────────

type CallContextValue = ReturnType<typeof useCallMode> | null;
const CallContext = createContext<CallContextValue>(null);

export function useCallContext() {
  return useContext(CallContext);
}

interface CallProviderProps {
  clientId: string;
  sessionId: string | null;
  relativePath: string;
  selectedModel: string;
  onCallMessage: (text: string, role: "user" | "assistant") => void;
  children: React.ReactNode;
}

export function CallProvider({
  clientId,
  sessionId,
  relativePath,
  selectedModel,
  onCallMessage,
  children,
}: CallProviderProps) {
  const call = useCallMode({
    apiUrl: API_URL,
    clientId,
    sessionId,
    workDir: relativePath,
    model: selectedModel,
    onCallMessage,
  });

  return <CallContext.Provider value={call}>{children}</CallContext.Provider>;
}

// ── Inline button (in input row next to voice mic) ──────────────

export function CallButton({
  isConnected,
  isStreaming,
  otherModeActive = false,
}: {
  isConnected: boolean;
  isStreaming: boolean;
  otherModeActive?: boolean;
}) {
  const call = useCallContext();
  if (!call) return null;

  if (call.isInCall) {
    return (
      <button
        onClick={call.endCall}
        className="shrink-0 bg-fg px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-void transition-colors hover:bg-fg-2"
        title="End call mode"
      >
        END
      </button>
    );
  }

  return (
    <button
      onClick={call.startCall}
      disabled={!isConnected || isStreaming || otherModeActive}
      className="shrink-0 p-2 text-fg-3 transition-colors hover:text-fg disabled:opacity-30"
      title={otherModeActive ? "End voice mode first" : "Start call mode (hands-free)"}
    >
      {/* Headset / phone icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-5 w-5"
      >
        <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z" />
      </svg>
    </button>
  );
}

// ── Call panel (above input area, only when in call) ─────────────

export function CallPanel() {
  const call = useCallContext();
  if (!call || !call.isInCall) return null;

  return (
    <div className="border-t-2 border-fg bg-void px-6 py-4">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          {/* State indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`h-2.5 w-2.5 ${
                call.state === "listening"
                  ? "animate-pulse-dot bg-fg"
                  : call.state === "thinking"
                    ? "animate-bounce-dot bg-fg"
                    : call.state === "speaking"
                      ? "bg-fg"
                      : "border border-fg"
              }`}
            />
            <span className="font-display text-[13px] font-bold uppercase tracking-[0.15em] text-fg">
              {STATE_LABELS[call.state] || "CALL MODE"}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={call.ttsMuted ? call.unmuteTts : call.muteTts}
              className={`border-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                call.ttsMuted
                  ? "border-fg bg-fg text-void"
                  : "border-fg text-fg hover:bg-panel-2"
              }`}
            >
              {call.ttsMuted ? "UNMUTE" : "MUTE"}
            </button>
            <button
              onClick={call.endCall}
              className="border-2 border-fg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-fg transition-colors hover:bg-fg hover:text-void"
            >
              END
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
