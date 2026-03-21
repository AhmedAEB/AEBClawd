import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Transcribe audio via the configured STT service (faster-whisper).
 *
 * @param audioBuffer - Raw audio data (WebM/Opus blob from browser MediaRecorder)
 * @returns Transcribed text, or null if no STT service is configured.
 */
export async function transcribe(
  audioBuffer: Buffer,
): Promise<string | null> {
  if (!env.STT_URL) {
    logger.info("[stt] No STT_URL configured — using client-provided transcript");
    return null;
  }

  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([audioBuffer.buffer as ArrayBuffer], { type: "audio/webm" }),
      "audio.webm",
    );
    formData.append("model", "whisper-1");

    const res = await fetch(`${env.STT_URL}/v1/audio/transcriptions`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error(`[stt] HTTP ${res.status}: ${text}`);
      return null;
    }

    const data = (await res.json()) as { text: string };
    logger.info(`[stt] Transcribed: "${data.text.slice(0, 80)}"`);
    return data.text.trim();
  } catch (err: any) {
    logger.error(`[stt] Error: ${err.message}`);
    return null;
  }
}
