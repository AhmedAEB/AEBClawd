"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAudioPlayback } from "./use-audio-playback";
import { float32ToWav } from "../lib/float32-to-wav";

export type CallState = "idle" | "listening" | "thinking" | "speaking";

interface UseCallModeOptions {
  apiUrl: string;
  clientId: string;
  sessionId: string | null;
  workDir: string;
  model: string;
  onCallMessage: (text: string, role: "user" | "assistant") => void;
}

export function useCallMode(options: UseCallModeOptions) {
  const { apiUrl, clientId, sessionId, workDir, model, onCallMessage } = options;

  const [state, setState] = useState<CallState>("idle");
  const [isInCall, setIsInCall] = useState(false);
  const [ttsMuted, setTtsMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const vadRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const isTtsPlayingRef = useRef(false);
  const claudeTextBufferRef = useRef("");
  // Use refs for values accessed in WS handler to avoid stale closures
  const ttsMutedRef = useRef(false);
  const onCallMessageRef = useRef(onCallMessage);
  onCallMessageRef.current = onCallMessage;

  const {
    playPcmChunk,
    stopAll: stopAudio,
    setOnAllPlaybackFinished,
    dispose: disposeAudio,
  } = useAudioPlayback();

  // ── WebSocket message handler (uses refs to avoid stale closures) ──
  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      // Binary = TTS audio
      if (event.data instanceof ArrayBuffer) {
        isTtsPlayingRef.current = true;
        if (!ttsMutedRef.current) playPcmChunk(event.data);
        return;
      }
      if (event.data instanceof Blob) {
        isTtsPlayingRef.current = true;
        event.data.arrayBuffer().then((buf) => {
          if (!ttsMutedRef.current) playPcmChunk(buf);
        });
        return;
      }

      // JSON message
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "state":
            setState(msg.state);
            if (msg.state === "speaking") {
              isTtsPlayingRef.current = true;
            }
            // If state goes to "listening" from server (e.g., no TTS configured),
            // ensure echo gate is cleared so VAD can send again
            if (msg.state === "listening") {
              isTtsPlayingRef.current = false;
            }
            break;

          case "transcript_final":
            onCallMessageRef.current(msg.text, "user");
            break;

          case "claude_text":
            if (msg.done) {
              onCallMessageRef.current(claudeTextBufferRef.current, "assistant");
              claudeTextBufferRef.current = "";
              // If no TTS audio was played (muted or unavailable), clear echo gate
              if (ttsMutedRef.current) {
                isTtsPlayingRef.current = false;
              }
            } else {
              claudeTextBufferRef.current += msg.text;
            }
            break;

          case "call_started":
            setIsInCall(true);
            break;

          case "call_ended":
            setIsInCall(false);
            setState("idle");
            break;

          case "error":
            console.error("[call-mode] Server error:", msg.message);
            break;
        }
      } catch {
        // Ignore
      }
    },
    [playPcmChunk],
  );

  // ── Echo gate: when all TTS audio finishes playing, re-enable VAD ──
  useEffect(() => {
    setOnAllPlaybackFinished(() => {
      isTtsPlayingRef.current = false;
    });
  }, [setOnAllPlaybackFinished]);

  // ── Start a call ──────────────────────────────────────────────
  const startCall = useCallback(async () => {
    // Connect WebSocket first
    const wsUrl = apiUrl.replace(/^http/, "ws") + "/ws/voice";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      ws.send(
        JSON.stringify({
          type: "start_call",
          clientId,
          workDir,
          model,
          sessionId: sessionId || undefined,
          mode: "call",
        }),
      );

      // Initialize VAD after WebSocket is ready
      try {
        const { MicVAD } = await import("@ricky0123/vad-web");

        const vad = await MicVAD.new({
          model: "v5",
          baseAssetPath: "/vad/",
          onnxWASMBasePath: "/vad/",
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          redemptionMs: 800,
          preSpeechPadMs: 300,
          minSpeechMs: 250,

          onSpeechEnd: (audio: Float32Array) => {
            // Echo gate: ignore speech during TTS playback
            if (isTtsPlayingRef.current) {
              return;
            }

            const currentWs = wsRef.current;
            if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;

            // Convert Float32Array (16kHz) to WAV and send as binary
            const wavBuffer = float32ToWav(audio, 16000);
            currentWs.send(wavBuffer);
          },
        });

        vadRef.current = vad;
        await vad.start();
      } catch (err) {
        console.error("[call-mode] Failed to initialize VAD:", err);
        ws.close();
      }
    };

    ws.onmessage = (event) => handleWsMessage(event);

    ws.onclose = () => {
      setIsInCall(false);
      setState("idle");
      wsRef.current = null;
    };

    ws.onerror = () => {};
  }, [apiUrl, clientId, sessionId, workDir, model, handleWsMessage]);

  // ── End a call ────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    if (vadRef.current) {
      try { await vadRef.current.destroy(); } catch {}
      vadRef.current = null;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end_call" }));
    }
    ws?.close();
    wsRef.current = null;

    stopAudio();
    isTtsPlayingRef.current = false;
    claudeTextBufferRef.current = "";
    setIsInCall(false);
    setState("idle");
  }, [stopAudio]);

  // ── TTS mute (update both state and ref) ──────────────────────
  const muteTts = useCallback(() => {
    setTtsMuted(true);
    ttsMutedRef.current = true;
    stopAudio();
    isTtsPlayingRef.current = false;
    wsRef.current?.send(JSON.stringify({ type: "mute_tts" }));
  }, [stopAudio]);

  const unmuteTts = useCallback(() => {
    setTtsMuted(false);
    ttsMutedRef.current = false;
    wsRef.current?.send(JSON.stringify({ type: "unmute_tts" }));
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        try { vadRef.current.destroy(); } catch {}
        vadRef.current = null;
      }
      wsRef.current?.close();
      disposeAudio();
    };
  }, [disposeAudio]);

  return {
    state,
    isInCall,
    ttsMuted,
    startCall,
    endCall,
    muteTts,
    unmuteTts,
  };
}
