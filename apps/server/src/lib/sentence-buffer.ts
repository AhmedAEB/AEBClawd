/**
 * Buffers streamed tokens from Claude and emits complete sentences for TTS.
 *
 * Detects sentence boundaries at `. `, `! `, `? `, or `\n` with a minimum
 * length threshold to avoid false splits on abbreviations like "Dr." or "U.S.".
 */
export class SentenceBuffer {
  private buffer = "";
  private minLength: number;

  constructor(minLength = 20) {
    this.minLength = minLength;
  }

  /**
   * Add a token to the buffer.
   * Returns a complete sentence if a boundary was found, otherwise null.
   */
  addToken(token: string): string | null {
    this.buffer += token;

    // Look for sentence-ending punctuation followed by whitespace
    const match = this.buffer.match(/^(.+?[.!?])\s+(.*)/s);
    if (match && match[1].length >= this.minLength) {
      const sentence = match[1].trim();
      this.buffer = match[2];
      return sentence;
    }

    // Also split on double newlines (paragraph breaks)
    const nlMatch = this.buffer.match(/^(.+?)\n\n(.*)/s);
    if (nlMatch && nlMatch[1].trim().length >= this.minLength) {
      const sentence = nlMatch[1].trim();
      this.buffer = nlMatch[2];
      return sentence;
    }

    return null;
  }

  /**
   * Flush any remaining text in the buffer (call when Claude stream ends).
   */
  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = "";
    return remaining.length > 0 ? remaining : null;
  }

  /** Reset the buffer without returning content. */
  clear(): void {
    this.buffer = "";
  }
}
