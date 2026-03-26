import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Transcribe audio via the configured STT service (faster-whisper).
 *
 * @param audioBuffer - Raw audio data
 * @param mimeType - Audio MIME type ("audio/webm" for voice mode, "audio/wav" for call mode)
 * @returns Transcribed text, or null if no STT service is configured.
 */
export async function transcribe(
  audioBuffer: Buffer,
  mimeType: string = "audio/webm",
): Promise<string | null> {
  if (!env.STT_URL) {
    logger.info("[stt] No STT_URL configured — using client-provided transcript");
    return null;
  }

  try {
    const formData = new FormData();
    const ext = mimeType === "audio/wav" ? "wav" : "webm";
    // Slice the underlying ArrayBuffer to avoid referencing shared pool memory
    const safeBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    );
    formData.append(
      "file",
      new Blob([safeBuffer], { type: mimeType }),
      `audio.${ext}`,
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[stt] Error: ${message}`);
    return null;
  }
}
