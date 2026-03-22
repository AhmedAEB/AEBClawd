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
  /** Called when voice produces a message to display in chat. */
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

  const {
    playPcmChunk,
    stopAll: stopAudio,
    stopFallback,
    dispose: disposeAudio,
  } = useAudioPlayback();

  // ── WebSocket message handler ─────────────────────────────────
  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      // Binary frame = TTS audio
      if (event.data instanceof ArrayBuffer) {
        if (!ttsMuted) playPcmChunk(event.data);
        return;
      }

      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          if (!ttsMuted) playPcmChunk(buf);
        });
        return;
      }

      // JSON message
      try {
        const msg = JSON.parse(event.data);
        console.log("[voice] Parsed message:", msg.type, msg);

        switch (msg.type) {
          case "state":
            console.log("[voice] Setting state to:", msg.state);
            setState(msg.state);
            break;

          case "transcript_final":
            setTranscript(msg.text);
            onVoiceMessage(msg.text, "user");
            break;

          case "claude_text":
            if (msg.done) {
              onVoiceMessage(claudeTextBufferRef.current, "assistant");
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
    [ttsMuted, playPcmChunk, onVoiceMessage],
  );

  // ── Start a voice call ────────────────────────────────────────
  const startCall = useCallback(async () => {
    console.log("[voice] startCall triggered");
    console.log("[voice] navigator.mediaDevices:", !!navigator.mediaDevices);

    // Request mic permission
    let stream: MediaStream;
    try {
      console.log("[voice] Requesting getUserMedia...");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log("[voice] Mic access granted");
    } catch (err) {
      console.error("[voice] Mic access denied:", err);
      alert("Microphone access is required for voice mode.");
      return;
    }
    mediaStreamRef.current = stream;

    // Connect WebSocket
    const wsUrl = apiUrl.replace(/^http/, "ws") + "/ws/voice";
    console.log("[voice] Connecting WebSocket:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      console.log("[voice] WebSocket connected, sending start_call");
      ws.send(
        JSON.stringify({
          type: "start_call",
          clientId,
          workDir,
          model,
          sessionId: sessionId || undefined,
        }),
      );
    };

    ws.onmessage = (event) => {
      console.log("[voice] WS message received:", typeof event.data, event.data instanceof ArrayBuffer ? `binary ${event.data.byteLength}b` : String(event.data).slice(0, 200));
      handleWsMessage(event);
    };

    ws.onclose = (event) => {
      console.log("[voice] WebSocket closed:", event.code, event.reason);
      setIsInCall(false);
      setState("idle");
      wsRef.current = null;
    };

    ws.onerror = (event) => {
      console.error("[voice] WebSocket error:", event);
    };
  }, [apiUrl, clientId, sessionId, workDir, model, handleWsMessage]);

  // ── End a voice call ──────────────────────────────────────────
  const endCall = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "end_call" }));
    }
    ws?.close();
    wsRef.current = null;

    // Release mic
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;

    // Stop audio
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
      // Stop recording and send
      setIsRecording(false);
      const ws = wsRef.current;
      const recorder = mediaRecorderRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          chunksRef.current = [];

          // Send audio as binary
          blob.arrayBuffer().then((buf) => {
            ws.send(buf);
            ws.send(JSON.stringify({ type: "ptt_end" }));
          });

          mediaRecorderRef.current = null;
        };
      }
    } else {
      // Start recording
      const ws = wsRef.current;
      const stream = mediaStreamRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !stream) return;

      // Stop any playing audio
      stopAudio();
      stopFallback();

      // Signal server
      ws.send(JSON.stringify({ type: "ptt_start" }));
      setIsRecording(true);
      setClaudeText("");
      claudeTextBufferRef.current = "";

      // Start recording
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(100); // 100ms chunks
      mediaRecorderRef.current = recorder;
    }
  }, [isRecording, stopAudio, stopFallback]);

  // ── Send text through voice pipeline (for mock mode / typing during call)
  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;
    ws.send(JSON.stringify({ type: "text_input", text: text.trim() }));
  }, []);

  // ── TTS mute controls ────────────────────────────────────────
  const muteTts = useCallback(() => {
    setTtsMuted(true);
    stopAudio();
    stopFallback();
    wsRef.current?.send(JSON.stringify({ type: "mute_tts" }));
  }, [stopAudio, stopFallback]);

  const unmuteTts = useCallback(() => {
    setTtsMuted(false);
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
