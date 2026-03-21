"use client";

import { useRef, useCallback } from "react";

/**
 * Hook for playing PCM audio chunks via Web Audio API with gapless scheduling,
 * plus a SpeechSynthesis fallback for mock mode (no TTS server).
 */
export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    // Resume if suspended (browser autoplay policy)
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Play a PCM audio chunk (Float32 or Int16 at 24kHz mono).
   * Schedules gapless playback so consecutive chunks play seamlessly.
   */
  const playPcmChunk = useCallback(
    (arrayBuffer: ArrayBuffer) => {
      const ctx = getAudioContext();

      // Kokoro-FastAPI outputs PCM as 16-bit signed integers at 24kHz
      const int16 = new Int16Array(arrayBuffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      // Schedule gapless playback
      const now = ctx.currentTime;
      nextPlayTimeRef.current = Math.max(nextPlayTimeRef.current, now);
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;

      activeSourcesRef.current.push(source);

      // Clean up finished sources
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(
          (s) => s !== source,
        );
      };
    },
    [getAudioContext],
  );

  /** Stop all currently playing and scheduled audio. */
  const stopAll = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  /**
   * Fallback TTS using browser SpeechSynthesis (for mock mode when no TTS server).
   */
  const speakFallback = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    speechSynthesis.speak(utterance);
  }, []);

  /** Stop browser SpeechSynthesis. */
  const stopFallback = useCallback(() => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
  }, []);

  /** Clean up AudioContext. */
  const dispose = useCallback(() => {
    stopAll();
    stopFallback();
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, [stopAll, stopFallback]);

  return {
    playPcmChunk,
    stopAll,
    speakFallback,
    stopFallback,
    dispose,
  };
}
