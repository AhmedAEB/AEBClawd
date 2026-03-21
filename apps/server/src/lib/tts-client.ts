import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Synthesize speech via the configured TTS service (Kokoro-FastAPI).
 *
 * @param text  - Text to synthesize
 * @param voice - Kokoro voice ID (defaults to env.TTS_VOICE)
 * @returns PCM audio buffer, or null if no TTS service is configured.
 */
export async function synthesize(
  text: string,
  voice?: string,
): Promise<Buffer | null> {
  if (!env.TTS_URL) {
    logger.info("[tts] No TTS_URL configured — client will use SpeechSynthesis");
    return null;
  }

  try {
    const res = await fetch(`${env.TTS_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        voice: voice || env.TTS_VOICE,
        input: text,
        response_format: "pcm",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`[tts] HTTP ${res.status}: ${errText}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    logger.info(`[tts] Synthesized ${arrayBuffer.byteLength} bytes for "${text.slice(0, 40)}"`);
    return Buffer.from(arrayBuffer);
  } catch (err: any) {
    logger.error(`[tts] Error: ${err.message}`);
    return null;
  }
}
