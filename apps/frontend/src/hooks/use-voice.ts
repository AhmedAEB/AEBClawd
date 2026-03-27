"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAudioPlayback } from "./use-audio-playback";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

interface UseVoiceOptions {
  apiUrl: string;
  clientId: string;
  sessionId: string | null;
  workDir: string;
  model: string;
  onVoiceMessage: (text: string, role: "user" | "assistant") => void;
}

export function useVoice(options: UseVoiceOptions) {
  const { apiUrl, clientId, sessionId, workDir, model, onVoiceMessage } =
    options;

  const [state, setState] = useState<VoiceState>("idle");
  const [isInCall, setIsInCall] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [ttsMuted, setTtsMuted] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [claudeText, setClaudeText] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const claudeTextBufferRef = useRef("");
  // Use ref for ttsMuted to avoid stale closure in WS handler
  const ttsMutedRef = useRef(false);
  const onVoiceMessageRef = useRef(onVoiceMessage);
  onVoiceMessageRef.current = onVoiceMessage;

  const {
    playPcmChunk,
    stopAll: stopAudio,
    stopFallback,
    dispose: disposeAudio,
  } = useAudioPlayback();

  // ── WebSocket message handler (uses refs to avoid stale closures) ──
  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      // Binary = TTS audio
      if (event.data instanceof ArrayBuffer) {
        if (!ttsMutedRef.current) playPcmChunk(event.data);
        return;
      }
      if (event.data instanceof Blob) {
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
            break;

          case "transcript_final":
            setTranscript(msg.text);
            onVoiceMessageRef.current(msg.text, "user");
            break;

          case "claude_text":
            if (msg.done) {
              onVoiceMessageRef.current(claudeTextBufferRef.current, "assistant");
              claudeTextBufferRef.current = "";
              setClaudeText("");
            } else {
              claudeTextBufferRef.current += msg.text;
              setClaudeText(claudeTextBufferRef.current);
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
            console.error("[voice] Server error:", msg.message);
            break;
        }
      } catch {
        // Ignore unparseable messages
      }
    },
    [playPcmChunk],
  );

  // ── Start a voice call ────────────────────────────────────────
  const startCall = useCallback(async () => {
    // Request mic permission
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      alert("Microphone access is required for voice mode.");
      return;
    }
    mediaStreamRef.current = stream;

    // Connect WebSocket
    const wsUrl = apiUrl
      ? apiUrl.replace(/^http/, "ws") + "/ws/voice"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/voice`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "start_call",
          clientId,
          workDir,
          model,
          sessionId: sessionId || undefined,
          mode: "voice",
        }),
      );
    };

    ws.onmessage = (event) => handleWsMessage(event);

    ws.onclose = () => {
      setIsInCall(false);
      setState("idle");
      wsRef.current = null;
    };

    ws.onerror = () => {};
  }, [apiUrl, clientId, sessionId, workDir, model, handleWsMessage]);

  // ── End a voice call ──────────────────────────────────────────
  const endCall = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end_call" }));
    }
    ws?.close();
    wsRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];

    stopAudio();
    stopFallback();

    setIsInCall(false);
    setState("idle");
    setTranscript("");
    setClaudeText("");
    claudeTextBufferRef.current = "";
  }, [stopAudio, stopFallback]);

  // ── Toggle recording (click to start, click to stop) ─────────
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      const ws = wsRef.current;
      const recorder = mediaRecorderRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          chunksRef.current = [];
          blob.arrayBuffer().then((buf) => {
            // Guard against WS closing while blob was being read
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(buf);
              wsRef.current.send(JSON.stringify({ type: "ptt_end" }));
            }
          });
          mediaRecorderRef.current = null;
        };
      }
    } else {
      const ws = wsRef.current;
      const stream = mediaStreamRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !stream) return;

      stopAudio();
      stopFallback();

      ws.send(JSON.stringify({ type: "ptt_start" }));
      setIsRecording(true);
      setClaudeText("");
      claudeTextBufferRef.current = "";

      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
    }
  }, [isRecording, stopAudio, stopFallback]);

  // ── Send text through voice pipeline ──────────────────────────
  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
    ws.send(JSON.stringify({ type: "text_input", text: text.trim() }));
  }, []);

  // ── TTS mute controls (update both state and ref) ─────────────
  const muteTts = useCallback(() => {
    setTtsMuted(true);
    ttsMutedRef.current = true;
    stopAudio();
    stopFallback();
    wsRef.current?.send(JSON.stringify({ type: "mute_tts" }));
  }, [stopAudio, stopFallback]);

  const unmuteTts = useCallback(() => {
    setTtsMuted(false);
    ttsMutedRef.current = false;
    wsRef.current?.send(JSON.stringify({ type: "unmute_tts" }));
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      endCall();
      disposeAudio();
    };
  }, [endCall, disposeAudio]);

  return {
    state,
    isInCall,
    isRecording,
    ttsMuted,
    transcript,
    claudeText,
    startCall,
    endCall,
    toggleRecording,
    sendText,
    muteTts,
    unmuteTts,
  };
}
