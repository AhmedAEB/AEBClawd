"use client";

import { useRef, useCallback } from "react";

/**
 * Hook for playing PCM audio chunks via Web Audio API with gapless scheduling.
 * Tracks active playback count for echo gate support (call mode).
 */
export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const activeCountRef = useRef(0);
  const onAllFinishedRef = useRef<(() => void) | null>(null);
  const finishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Play a PCM audio chunk (Int16 at 24kHz mono from Kokoro-FastAPI).
   * Schedules gapless playback so consecutive chunks play seamlessly.
   */
  const playPcmChunk = useCallback(
    (arrayBuffer: ArrayBuffer) => {
      const ctx = getAudioContext();

      // Clear any pending "all finished" timer since new audio arrived
      if (finishedTimerRef.current) {
        clearTimeout(finishedTimerRef.current);
        finishedTimerRef.current = null;
      }

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

      activeCountRef.current++;
      activeSourcesRef.current.push(source);

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(
          (s) => s !== source,
        );
        activeCountRef.current--;

        // When all audio finished, notify after 200ms buffer (for room reverberation)
        if (activeCountRef.current <= 0) {
          activeCountRef.current = 0;
          finishedTimerRef.current = setTimeout(() => {
            if (activeCountRef.current <= 0 && onAllFinishedRef.current) {
              onAllFinishedRef.current();
            }
            finishedTimerRef.current = null;
          }, 200);
        }
      };
    },
    [getAudioContext],
  );

  /** Returns true if any audio is currently playing or scheduled. */
  const isPlaying = useCallback(() => {
    return activeCountRef.current > 0;
  }, []);

  /** Stop all currently playing and scheduled audio. */
  const stopAll = useCallback(() => {
    if (finishedTimerRef.current) {
      clearTimeout(finishedTimerRef.current);
      finishedTimerRef.current = null;
    }
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    activeSourcesRef.current = [];
    activeCountRef.current = 0;
    nextPlayTimeRef.current = 0;
  }, []);

  /** Register a callback for when all playback finishes (for echo gate). */
  const setOnAllPlaybackFinished = useCallback((cb: (() => void) | null) => {
    onAllFinishedRef.current = cb;
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
    isPlaying,
    stopAll,
    setOnAllPlaybackFinished,
    stopFallback,
    dispose,
  };
}
