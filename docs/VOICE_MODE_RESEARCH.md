# Voice Mode Research — AEBClawd

> Design document for adding a "calling with Claude" voice mode to AEBClawd.
>
> **Constraints:**
> - 100% free — all models open source, self-hosted, no per-use API costs
> - Must support multiple users
> - Must work reliably on mobile (iOS, Android)
> - Must work identically across all browsers
> - User can type in the middle of a voice call
> - Experience should feel like a phone call with Claude
>
> **Anthropic SDK Note:** As of March 2026, the Anthropic API has zero audio capabilities. The entire voice pipeline (STT, TTS, VAD) must be self-hosted. Claude only handles text.
>
> **Last validated:** March 22, 2026 — all libraries, maintenance status, and known issues verified against live GitHub/npm data.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Why Server-Side](#2-why-server-side)
3. [STT: faster-whisper (Self-Hosted)](#3-stt-faster-whisper-self-hosted)
4. [TTS: Kokoro-FastAPI (Self-Hosted)](#4-tts-kokoro-fastapi-self-hosted)
5. [Client-Side: VAD + Thin Audio](#5-client-side-vad--thin-audio)
6. [Hono WebSocket Layer](#6-hono-websocket-layer)
7. [Full Pipeline Flow](#7-full-pipeline-flow)
8. [Latency Analysis & Optimization](#8-latency-analysis--optimization)
9. [Hard Problems: Interruption & Buffering](#9-hard-problems-interruption--buffering)
10. [Hybrid Input — Typing During a Call](#10-hybrid-input--typing-during-a-call)
11. [UX Design — "Calling with Claude"](#11-ux-design--calling-with-claude)
12. [Technical Implementation Details](#12-technical-implementation-details)
13. [Deployment — Docker Compose](#13-deployment--docker-compose)
14. [Packages & Dependencies](#14-packages--dependencies)
15. [Implementation Phases](#15-implementation-phases)
16. [Known Risks & Mitigations](#16-known-risks--mitigations)
17. [Alternative: All-Node.js (No Python/Docker)](#17-alternative-all-nodejs-no-pythondocker)
18. [Rejected Alternatives & Why](#18-rejected-alternatives--why)
19. [Sources](#19-sources)

---

## 1. Architecture Overview

```
┌──────────────────────┐       WebSocket        ┌──────────────────────────────┐
│   BROWSER (thin)     │◄─────────────────────►│   HONO BACKEND               │
│                      │   audio up / down      │   (Node.js)                  │
│  - Mic capture       │   + transcript         │                              │
│  - Speaker playback  │                        │  ┌────────────────────────┐  │
│  - VAD (speech detect)│                       │  │  WebSocket handler     │  │
│  - Waveform UI       │                        │  │  orchestrates:         │  │
│  - Call controls     │                        │  │  audio → STT → Claude  │  │
│  - Transcript display│                        │  │  → TTS → audio back    │  │
│                      │                        │  └─────┬────────┬────────┘  │
│  Zero models         │                        │        │        │           │
│  Zero downloads      │                        │  Claude Agent SDK (text)    │
│  Works everywhere    │                        └────────┼────────┼───────────┘
└──────────────────────┘                                 │        │
                                                  HTTP   │        │  HTTP
                                          ┌──────────────▼──┐  ┌──▼──────────────┐
                                          │  faster-whisper  │  │  Kokoro-FastAPI  │
                                          │  (Docker)        │  │  (Docker)        │
                                          │                  │  │                  │
                                          │  STT service     │  │  TTS service     │
                                          │  GPU accelerated │  │  GPU accelerated │
                                          └─────────────────┘  └─────────────────┘
```

**Four components:**
1. **Browser** — captures mic, plays audio, runs VAD, shows UI. No ML models.
2. **Hono backend** — orchestrates the pipeline via WebSocket. Receives audio, calls STT, calls Claude, calls TTS, streams audio back.
3. **faster-whisper** — self-hosted STT in a Docker container. GPU-accelerated Whisper inference.
4. **Kokoro-FastAPI** — self-hosted TTS in a Docker container. GPU-accelerated neural speech synthesis.

**Why two containers instead of one?** See [Section 18: Rejected Alternatives](#18-rejected-alternatives--why) — the "all-in-one" Speaches project is effectively abandoned.

---

## 2. Why Server-Side

| Requirement | Client-side | Server-side |
|------------|-------------|-------------|
| Multiple users | Each downloads ~100MB models | Models loaded once on server |
| Mobile (iOS/Android) | Kokoro-JS broken on Safari/iOS, WASM heavy on phones | Browser just streams audio. Works everywhere. |
| Consistent experience | Depends on device power | Fixed server hardware. Same quality for all. |
| "Calling" feel | Heavy WASM = lag on weak devices | Optimized server = consistent low latency |
| Model updates | Every user re-downloads | Update once on server |
| Battery / CPU | Drains user's device | Thin client, minimal battery impact |

**How production apps do it:**
- **ChatGPT:** LiveKit Agents (server-side) + GPT-4o speech-to-speech model
- **Open WebUI:** Server-side STT/TTS (Kokoro-FastAPI, faster-whisper). Their client-side Kokoro-JS attempt resulted in "hangs the browser" reports.
- **LibreChat:** Server-side STT/TTS providers

Our design is more sophisticated than Open WebUI and LibreChat because we stream TTS in parallel with Claude's token generation (sentence-boundary buffering), rather than waiting for the full response.

---

## 3. STT: faster-whisper (Self-Hosted)

### Why faster-whisper

The gold standard for self-hosted speech-to-text. CTranslate2 engine — **4x faster than OpenAI Whisper, uses less memory.** 14k+ GitHub stars, actively maintained.

### Key Stats

| Metric | Value |
|--------|-------|
| GitHub stars | 14k+ |
| Latest version | 1.2.1 (Oct 2025) |
| Engine | CTranslate2 |
| Quantization | int8, float16 |
| GPU support | CUDA |
| Languages | 99 (all Whisper languages) |

### Recommended Model

**`Systran/faster-distil-whisper-small.en`** — distilled English model. Faster than standard `small` with near-identical accuracy.

For multilingual: `Systran/faster-whisper-large-v3-turbo` — 8x faster than v3 (released Sep 2024).

### Performance

| Model | Hardware | 13min audio | Real-time factor |
|-------|----------|------------|-----------------|
| large-v2 int8 batch=8 | RTX 3070 Ti | 16s | ~49x |
| small int8 | RTX 3070 Ti | ~30s | ~26x |
| small int8 | i7-12700K (CPU) | 1m42s | ~7.6x |

For real-time voice (processing 2-3s chunks): even CPU handles `small` model comfortably.

### Running as a Service

faster-whisper is a Python library, not a server. You need a thin API wrapper. Two options:

**Option A: Minimal FastAPI wrapper (recommended)**

```python
# stt_server.py — ~30 lines
from fastapi import FastAPI, UploadFile
from faster_whisper import WhisperModel
import tempfile, uvicorn

app = FastAPI()
model = WhisperModel("Systran/faster-distil-whisper-small.en", device="cuda", compute_type="int8")

@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile):
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(await file.read())
        tmp.flush()
        segments, _ = model.transcribe(tmp.name, beam_size=5)
        text = " ".join(seg.text for seg in segments)
    return {"text": text.strip()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

This gives you an OpenAI-compatible `/v1/audio/transcriptions` endpoint.

**Option B: Use wyoming-faster-whisper** (pre-built Docker, but uses Wyoming protocol — less standard)

### Dockerfile

```dockerfile
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg
RUN pip3 install faster-whisper==1.2.1 fastapi uvicorn python-multipart

COPY stt_server.py /app/stt_server.py
WORKDIR /app

# Pre-download model
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('Systran/faster-distil-whisper-small.en', device='cpu')"

CMD ["python3", "stt_server.py"]
EXPOSE 8001
```

---

## 4. TTS: Kokoro-FastAPI (Self-Hosted)

### Why Kokoro-FastAPI

Most actively maintained self-hosted TTS server with an OpenAI-compatible API. Uses Kokoro-82M — ranked #1 open-weight TTS model on TTS Arena.

### Key Stats

| Metric | Value |
|--------|-------|
| GitHub stars | 4.6k |
| Last commit | Jan 2026 |
| Model | Kokoro-82M (ranked #1 open-weight on TTS Arena) |
| API | OpenAI-compatible `/v1/audio/speech` |
| Streaming | Yes (auto-chunks at sentence boundaries) |
| Output formats | mp3, wav, opus, flac, pcm |
| Docker images | GPU: `ghcr.io/remsky/kokoro-fastapi-gpu`, CPU: `ghcr.io/remsky/kokoro-fastapi-cpu` |

### Performance

| Hardware | First-token latency | Real-time factor |
|----------|-------------------|-----------------|
| RTX 4060 Ti (GPU) | ~300ms | 35-100x real-time |
| i7-11700 (CPU) | ~3500ms | Too slow for conversation |

**GPU is required** for conversational TTS latency. CPU Kokoro is ~3.5s — unacceptable for a "calling" feel.

**No GPU fallback:** Use **Piper TTS** (VITS-based, fast on CPU, lower quality) or browser `SpeechSynthesis`.

### API Usage

```bash
# Generate speech (OpenAI-compatible)
curl -X POST http://localhost:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kokoro",
    "voice": "af_heart",
    "input": "The auth middleware issue is in the session handler.",
    "response_format": "pcm"
  }' \
  --output speech.pcm
```

```typescript
// From Hono backend (Node.js)
async function synthesize(text: string, voice = "af_heart"): Promise<ArrayBuffer> {
  const res = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "kokoro",
      voice,
      input: text,
      response_format: "pcm",
    }),
  });
  return res.arrayBuffer();
}
```

### Voices

| Voice ID | Description |
|----------|-------------|
| `af_heart` | American female, warm (good default) |
| `af_bella` | American female, clear |
| `am_adam` | American male |
| `am_michael` | American male, deeper |
| `bf_emma` | British female |
| `bm_george` | British male |
| 21 total voices | English, Japanese, Korean, Chinese, Vietnamese |

### Docker Setup

```bash
# GPU
docker run -d --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest

# CPU (slow — only for testing)
docker run -d -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

---

## 5. Client-Side: VAD + Thin Audio

The browser has three jobs: capture mic audio, play received audio, show UI.

### VAD: @ricky0123/vad-web (client-side)

**Why client-side VAD?** The browser detects when the user starts/stops speaking locally. Benefits:
- Only sends speech segments over WebSocket (saves bandwidth)
- Instant local UI feedback (LISTENING → HEARING transition)
- Reduces server STT load (no silence processed)

| Metric | Value |
|--------|-------|
| npm | `@ricky0123/vad-web` v0.0.30 |
| Last published | Nov 2025 |
| Last GitHub commit | Jan 2026 |
| Weekly downloads | ~32,755 |
| Stars | 1.9k |
| Engine | Silero VAD via ONNX Runtime Web |
| Size | ~2 MB (WASM + model) |
| Status | **Actively maintained, de facto standard** |

```javascript
import { MicVAD } from "@ricky0123/vad-web";

const vad = await MicVAD.new({
  onSpeechStart: () => {
    ws.send(JSON.stringify({ type: "speech_start" }));
    setState("hearing");
  },
  onSpeechEnd: (audio) => {
    // audio is Float32Array at 16kHz — send as binary
    ws.send(audio.buffer);
    ws.send(JSON.stringify({ type: "speech_end" }));
    setState("thinking");
  },
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionFrames: 8,
  minSpeechFrames: 3,
});
```

### Audio Playback

Receive PCM audio chunks from server and play via Web Audio API:

```javascript
const audioContext = new AudioContext({ sampleRate: 24000 });
let nextPlayTime = 0;

function playAudioChunk(pcmData: ArrayBuffer) {
  const float32 = new Float32Array(pcmData);
  const buffer = audioContext.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);

  // Schedule seamless gapless playback
  const now = audioContext.currentTime;
  nextPlayTime = Math.max(nextPlayTime, now);
  source.start(nextPlayTime);
  nextPlayTime += buffer.duration;

  // Track for interruption
  activeSources.push(source);
}

function stopAllPlayback() {
  activeSources.forEach(s => { try { s.stop(); } catch {} });
  activeSources = [];
  nextPlayTime = 0;
}
```

### No Models, No Downloads

Zero ML model downloads on the client. VAD's Silero model is ~2MB (loaded from CDN or `public/`). Everything else runs server-side. First-time experience is instant.

---

## 6. Hono WebSocket Layer

### @hono/node-ws

| Metric | Value |
|--------|-------|
| npm | `@hono/node-ws` v1.3.0 |
| Published | Jan 2026 |
| Dependents | 81 packages |
| Status | Official Hono middleware |

### Known Gotchas (Validated)

1. **Don't use `await` in `upgradeWebSocket` callback** — causes message drops. Move async logic to `onOpen` or use preceding middleware.
2. **CORS middleware conflicts** — define WebSocket routes before `cors()` middleware, or exclude them.
3. **Binary streaming** — works at the `ws` library level. Use `ws.raw.send(buffer)` for binary ArrayBuffer sends if needed.

### Setup

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Define WebSocket route BEFORE cors() middleware
app.get("/ws/voice", upgradeWebSocket((c) => {
  let audioChunks: Buffer[] = [];
  let abortController: AbortController | null = null;

  return {
    onOpen(event, ws) {
      // Initialize voice session state
    },

    onMessage(event, ws) {
      if (event.data instanceof ArrayBuffer) {
        // Binary = audio chunk from client
        audioChunks.push(Buffer.from(event.data));
        return;
      }

      const msg = JSON.parse(event.data as string);
      handleVoiceMessage(msg, ws, audioChunks, abortController);
    },

    onClose() {
      abortController?.abort();
    },
  };
}));

// Existing HTTP routes
app.use("/api/*", cors());
app.route("/api/stream", streamRoutes);
app.route("/api/sessions", sessionsRoutes);
// ...

const server = serve({ fetch: app.fetch, port: 3001 });
injectWebSocket(server);
```

---

## 7. Full Pipeline Flow

### User speaks → hears Claude respond

```
Time   Browser                  Hono Server              STT/TTS Services     Claude API
───────────────────────────────────────────────────────────────────────────────────────

0ms    User speaks
       VAD: onSpeechStart ────► { type: "speech_start" }
       UI → HEARING

~2s    Audio chunks ──────────► Buffer in memory
       (binary Float32Array)

~2s    VAD: onSpeechEnd ──────► { type: "speech_end" }
       UI → THINKING           Concat audio buffer
                               POST to faster-whisper ──► Transcribe (~200-400ms)
                                                          ◄── "How do I fix the auth bug?"

~2.4s                          Send transcript to
                               ws client (for display)
                               Stream to Claude API ─────────────────────────► Process

~3.0s                          Claude streams tokens: ◄──────────────────────── "The" "issue"
                               Buffer sentence...                               "is" "in" ...
                               "The issue is in the session handler."

~3.1s                          POST sentence to ─────► Kokoro generates
                               Kokoro-FastAPI             audio (~300ms)
                                                          ◄── PCM audio

~3.4s  Play audio ◄──────────── Stream PCM to client
       "The issue is in..."     via WebSocket binary
       UI → SPEAKING

       Meanwhile:              Next sentence buffers → next TTS → next audio chunk
       Continuous speech       Pipeline keeps flowing until response complete
       with no gaps
```

**Total: ~3.4s from end of speech to hearing first word.**
With streaming optimization (partial STT, warm models): **~1.5-2s**.

---

## 8. Latency Analysis & Optimization

### Baseline Breakdown

| Step | Time | Bottleneck? |
|------|------|------------|
| VAD + audio capture | ~50ms | No |
| WebSocket transit (up) | ~10-30ms | No |
| STT (faster-whisper distil-small, GPU) | ~200-400ms | Minor |
| **Claude API (first token)** | **~500-1500ms** | **YES — the main bottleneck** |
| TTS (Kokoro, GPU) | ~300ms | Minor |
| WebSocket transit (down) | ~10-30ms | No |
| **Total** | **~1.1-2.4s** | |

The Claude API is the bottleneck. This delay exists whether you type or speak — voice adds ~400-800ms (STT + TTS) on top.

### Optimization 1: Sentence-Boundary Streaming TTS

Don't wait for Claude's full response. Send each sentence to TTS as soon as it's complete:

```
Claude: "The" "issue" "is" "in" "the" "session" "handler" "."
                                                             ↓ sentence boundary
                                                  → TTS immediately
                                                  → audio plays while next sentence generates
```

### Optimization 2: Keep Models Warm

- faster-whisper: keep model loaded in memory (don't reload per request)
- Kokoro-FastAPI: models stay loaded by default

### Optimization 3: Use Distilled/Smaller STT Models

`faster-distil-whisper-small.en` is faster than `small` with near-identical accuracy for English.

### Optimization 4: Parallel TTS Generation

While the first sentence plays on the client (~2-3 seconds of audio), generate the next sentence's audio in parallel. The user hears continuous speech with no gaps.

### Optimized Target

| Step | Optimized |
|------|-----------|
| Audio to server | ~50ms |
| STT | ~150-300ms |
| Claude first token | ~500-1000ms |
| TTS first chunk | ~200-300ms |
| Audio to browser | ~30ms |
| **Total** | **~1-1.5s** |

~1-1.5s feels like a natural conversational pause. Acceptable for a "calling" experience.

---

## 9. Hard Problems: Interruption & Buffering

These are the two hardest implementation challenges. Dedicated voice frameworks (Pipecat, LiveKit Agents) solve them out of the box. We're building them ourselves, so they need careful design.

### Problem 1: Barge-In (Interruption Handling)

**Scenario:** User speaks while Claude's TTS is still playing.

**What must happen (in order, within ~100ms):**

```
1. Client: VAD detects speech → send { type: "interrupt" } to server
2. Client: stopAllPlayback() — cancel all scheduled audio sources
3. Client: Transition UI to HEARING state
4. Server: Receive "interrupt" → abortController.abort() (cancels Claude stream)
5. Server: Discard any buffered TTS audio not yet sent
6. Server: Flush STT state (ready for new utterance)
7. Client: New audio chunks start flowing to server (new speech)
8. Server: Process new speech through STT → Claude → TTS cycle
```

**Implementation:**

```typescript
// Server-side interrupt handler
function handleInterrupt(ws, abortController, state) {
  // Cancel Claude stream
  abortController?.abort();

  // Clear TTS queue
  state.ttsQueue = [];
  state.sentenceBuffer = "";

  // Notify client
  ws.send(JSON.stringify({ type: "state", state: "listening" }));

  // Ready for new audio
  state.audioChunks = [];
}
```

```javascript
// Client-side interrupt
vad.onSpeechStart = () => {
  if (currentState === "speaking") {
    // Barge-in!
    stopAllPlayback();
    ws.send(JSON.stringify({ type: "interrupt" }));
    setState("hearing");
  }
};
```

**Edge cases to handle:**
- User makes a brief noise (cough) — VAD should have `minSpeechFrames: 3` to ignore these
- User starts speaking just as Claude finishes — race condition between "speech_end" from server and "interrupt" from client
- Network latency means the server may send 1-2 more TTS chunks after interrupt — client should discard them

### Problem 2: Sentence-Boundary TTS Buffering

**Scenario:** Claude streams tokens one at a time. We need to detect sentence boundaries to send complete sentences to TTS.

**Why this is hard:**
- Claude doesn't stream by sentence — it streams token-by-token
- Punctuation mid-sentence (e.g., "Dr. Smith" or "U.S. Army") triggers false boundaries
- Too-eager splitting = choppy TTS with unnatural pauses
- Too-late splitting = long silence before first TTS audio

**Implementation:**

```typescript
class SentenceBuffer {
  private buffer = "";
  private minLength = 20;  // Don't split sentences shorter than 20 chars

  addToken(token: string): string | null {
    this.buffer += token;

    // Check for sentence boundary
    const match = this.buffer.match(/^(.+?[.!?\n])\s/);
    if (match && match[1].length >= this.minLength) {
      const sentence = match[1].trim();
      this.buffer = this.buffer.slice(match[0].length);
      return sentence;
    }

    return null; // No complete sentence yet
  }

  flush(): string | null {
    // Call when Claude stream ends — flush remaining text
    const remaining = this.buffer.trim();
    this.buffer = "";
    return remaining.length > 0 ? remaining : null;
  }
}

// Usage in pipeline
const sentenceBuffer = new SentenceBuffer();

for await (const token of streamClaude(transcript)) {
  // Send token to client for display
  ws.send(JSON.stringify({ type: "claude_text", text: token }));

  // Buffer for TTS
  const sentence = sentenceBuffer.addToken(token);
  if (sentence) {
    const audio = await synthesize(sentence);
    ws.send(audio); // binary PCM
  }
}

// Flush remaining text
const remaining = sentenceBuffer.flush();
if (remaining) {
  const audio = await synthesize(remaining);
  ws.send(audio);
}
```

**Tuning tips:**
- `minLength: 20` prevents "Dr." or "U.S." from triggering premature splits
- For code-heavy responses, also split on `\n\n` (paragraph breaks)
- Consider a timeout: if no sentence boundary after 5s of tokens, flush buffer anyway

---

## 10. Hybrid Input — Typing During a Call

### How It Works

The voice call uses WebSocket (`/ws/voice`). Text chat uses HTTP (`POST /api/stream/prompt`). Both share the same Claude session:

- **Voice active + user types:** User clicks text input, types, presses Enter. Text goes via HTTP to Claude. Response streams back via SSE (existing flow) AND TTS audio plays via WebSocket.
- **Voice active + user speaks:** Audio goes via WebSocket → STT → Claude → TTS → audio back.
- **Shared session:** Both voice and text use the same `sessionId` / `resumeId`. Claude sees full conversation history regardless of input method.
- **Independent controls:** User can mute mic (listen-only) or mute TTS (voice-input, text-output).

### UI

The text input stays visible at the bottom during a voice call:

```
┌───────────────────────────────────────────┐
│  [Call UI — waveform, transcript, etc.]   │
│                                           │
│  ┌─────────────────────────────┐ [SEND]   │
│  │  Type a message...         │           │
│  └─────────────────────────────┘          │
└───────────────────────────────────────────┘
```

---

## 11. UX Design — "Calling with Claude"

Following the project's black-and-white brutalist aesthetic (per CLAUDE.md).

### Call States

| State | Visual | Audio |
|-------|--------|-------|
| **IDLE** (no call) | Call button: black border, phone icon, "START CALL" | — |
| **CONNECTING** | Pulsing border animation, "CONNECTING..." | — |
| **LISTENING** (waiting for user) | Mic icon active, "LISTENING" label | — |
| **HEARING** (user speaking) | Waveform bars animating, live transcript in grey | — |
| **THINKING** (Claude processing) | Three-dot animation, "THINKING" | — |
| **SPEAKING** (Claude responding) | Output waveform, transcript word-by-word | TTS playing |
| **INTERRUPTED** (barge-in) | Quick snap to HEARING | TTS stops |

### Full-Screen Call Mode

```
┌───────────────────────────────────────────────────────┐
│  AEBCLAWD                              [END CALL]     │
├───────────────────────────────────────────────────────┤
│                                                       │
│                                                       │
│                    ┌───────────┐                       │
│                    │           │                       │
│                    │  ██████   │                       │
│                    │  ██████   │  ← waveform / orb    │
│                    │  ██████   │                       │
│                    │           │                       │
│                    └───────────┘                       │
│                                                       │
│                    SPEAKING                            │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  "The auth middleware issue is in the session    │  │
│  │   handler. You need to check the token           │  │
│  │   expiration logic in lib/auth.ts..."            │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────┐ [SEND]           │
│  │  Type a message...             │                   │
│  └─────────────────────────────────┘                  │
│                                                       │
│  [MUTE MIC]              [MUTE TTS]                   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Controls (Brutalist Style)

- **Start Call:** Full-width, solid black bg, white text "START CALL"
- **End Call:** Border-2 outline, "END CALL", top-right
- **Mute Mic:** Toggle, border-2, solid black when muted
- **Mute TTS:** Toggle, border-2
- **Waveform:** Black bars on white, centered
- **Transcript:** Monospace, appears word-by-word
- **State label:** Uppercase, wide letter-spacing
- All: square corners, no shadows, no gradients, no colors

---

## 12. Technical Implementation Details

### Browser Audio Capture

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    sampleRate: 16000,
    echoCancellation: true,    // prevents TTS feedback into mic
    noiseSuppression: true,
    autoGainControl: true,
  }
});
```

- HTTPS required (or localhost)
- `echoCancellation: true` is sufficient for web apps — no server-side AEC needed
- VAD acts as additional echo gate: Silero detects human speech patterns, not speaker playback

### Audio Format

| Direction | Format | Why |
|-----------|--------|-----|
| Browser → Server | Raw PCM Float32Array, 16kHz mono | VAD outputs this directly. No encoding overhead. |
| Server → faster-whisper | WAV or raw PCM | Forward as-is |
| Kokoro-FastAPI → Server | Raw PCM, 24kHz | Configured via `response_format: "pcm"` |
| Server → Browser | Raw PCM binary | Minimal latency. Switch to Opus only if bandwidth is an issue. |

All audio transferred as **binary WebSocket frames**, never base64-encoded in JSON (base64 adds ~33% overhead).

### WebSocket Message Protocol

**Browser → Server:**
```typescript
{ type: "speech_start" }           // VAD detected speech
ArrayBuffer                         // Audio chunk (binary PCM Float32)
{ type: "speech_end" }             // VAD detected silence
{ type: "text_input", text: "..." } // User typed during call
{ type: "interrupt" }               // Barge-in: user spoke while Claude talking
{ type: "mute_mic" }
{ type: "unmute_mic" }
{ type: "mute_tts" }
{ type: "unmute_tts" }
{ type: "end_call" }
```

**Server → Browser:**
```typescript
{ type: "transcript_partial", text: "how do I fix" }  // STT interim
{ type: "transcript_final", text: "how do I fix the auth bug" }
{ type: "claude_text", text: "The", done: false }     // Claude token for display
{ type: "claude_text", text: "", done: true }          // Claude stream finished
ArrayBuffer                                             // TTS audio chunk (binary PCM)
{ type: "state", state: "listening" | "thinking" | "speaking" }
{ type: "error", message: "..." }
```

### Session Continuity

Voice turns use the same `sessionId` as text messages. The existing `resumeId` mechanism in `runQuery` handles this:

```typescript
// Each voice turn passes the same sessionId
const result = await runQuery({
  prompt: transcript,
  resumeId: sessionId,  // same session as previous voice/text turns
  cwd: workDir,
  model: selectedModel,
});
```

Claude sees the full conversation history across both voice and text turns.

---

## 13. Deployment — Docker Compose

```yaml
services:
  # Speech-to-Text
  stt:
    build:
      context: ./docker/stt
      dockerfile: Dockerfile
    ports:
      - "8001:8001"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes:
      - stt-models:/root/.cache
    restart: unless-stopped

  # Text-to-Speech
  tts:
    image: ghcr.io/remsky/kokoro-fastapi-gpu:latest
    ports:
      - "8880:8880"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

  # Hono Backend (existing + WebSocket)
  backend:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    ports:
      - "3001:3001"
    environment:
      - STT_URL=http://stt:8001
      - TTS_URL=http://tts:8880
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - WORKSPACES_ROOT=/workspaces
    depends_on:
      - stt
      - tts
    volumes:
      - ${WORKSPACES_ROOT}:/workspaces

  # Next.js Frontend (existing)
  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:3001
    depends_on:
      - backend

volumes:
  stt-models:
```

### GPU Requirements

| Service | VRAM | CPU fallback? |
|---------|------|--------------|
| faster-whisper (small, int8) | ~500 MB | Yes (slower but usable) |
| Kokoro TTS | ~500 MB | Too slow (~3.5s latency) |
| **Total** | **~1 GB** | STT: yes, TTS: no |

**Minimum:** GPU with 2+ GB VRAM (e.g., GTX 1050 Ti, any cloud GPU instance).

### No GPU? CPU-Only Option

- **STT:** CPU works for `small` model — adequate for real-time 2-3s chunks
- **TTS:** Replace Kokoro with **Piper TTS** (fast on CPU, lower quality) or use browser `SpeechSynthesis` as fallback

---

## 14. Packages & Dependencies

### Backend (new)

| Package | Purpose |
|---------|---------|
| `@hono/node-ws` | WebSocket support for Hono |

**1 new npm package.** That's it. STT and TTS run as separate Docker containers — no Python in your Node.js code.

### Frontend (new)

| Package | Purpose |
|---------|---------|
| `@ricky0123/vad-web` | Client-side VAD |
| `@ricky0123/vad-react` | React hooks for VAD |

**2 new npm packages.**

### Infrastructure (new)

| Container | Purpose |
|-----------|---------|
| faster-whisper (custom Dockerfile) | STT service |
| `ghcr.io/remsky/kokoro-fastapi-gpu` | TTS service |

**2 Docker containers.**

### Total: 3 npm packages + 2 Docker containers.

---

## 15. Implementation Phases

### Phase 1 — MVP (Push-to-Talk)

**Goal:** Working voice call. Push button to talk, hear Claude respond.

**Backend:**
- [ ] `npm install @hono/node-ws`
- [ ] Create `/ws/voice` WebSocket endpoint
- [ ] Implement pipeline: receive audio → HTTP POST to faster-whisper → Claude API → HTTP POST to Kokoro → stream audio back
- [ ] Add `STT_URL` and `TTS_URL` to env config
- [ ] Basic sentence buffering for TTS

**Frontend:**
- [ ] `npm install @ricky0123/vad-web @ricky0123/vad-react`
- [ ] Call UI component: start call, end call, mute buttons
- [ ] Mic capture via `getUserMedia`
- [ ] WebSocket connection to `/ws/voice`
- [ ] Push-to-talk: hold button → capture audio → send on release
- [ ] Play TTS audio via Web Audio API
- [ ] Display transcript
- [ ] States: LISTENING, THINKING, SPEAKING

**Infrastructure:**
- [ ] Dockerfile for faster-whisper STT service
- [ ] docker-compose with STT + TTS + backend
- [ ] Test on Chrome, Firefox, Safari, mobile

### Phase 2 — Conversational Call

**Goal:** Natural calling feel with auto-detection and interruption.

- [ ] Replace push-to-talk with VAD-triggered mode (auto-detect speech)
- [ ] Stream TTS per sentence as Claude streams (don't wait for full response)
- [ ] Barge-in: interrupt → cancel TTS → abort Claude → new cycle
- [ ] Partial STT transcript display (grey text while speaking)
- [ ] Waveform visualization (black bars)
- [ ] Mode selector: `[PUSH TO TALK | AUTO | OFF]`
- [ ] Hybrid input: text input works during call
- [ ] Full-screen call mode UI

### Phase 3 — Polish

**Goal:** Production-ready.

- [ ] Voice selector (Kokoro voice picker)
- [ ] TTS speed control
- [ ] Call history saved as sessions
- [ ] Keyboard shortcut: hold Space for push-to-talk
- [ ] Mobile-optimized controls (larger touch targets)
- [ ] WebSocket reconnection with exponential backoff
- [ ] Graceful degradation if STT/TTS containers are down
- [ ] Concurrent user limits / queue management

---

## 16. Known Risks & Mitigations

### Risk 1: GPU requirement for TTS

**Impact:** Kokoro on CPU is ~3.5s — too slow for conversation.
**Mitigation:**
- Use Piper TTS on CPU (lower quality, faster)
- Or browser `SpeechSynthesis` as zero-cost fallback
- Cloud GPU instances (e.g., Lambda, Vast.ai) are cheap for inference

### Risk 2: Interruption handling complexity

**Impact:** Barge-in is the hardest real-time problem. Race conditions between client and server.
**Mitigation:**
- Start with push-to-talk (Phase 1) — no interruption logic needed
- Add VAD-triggered with interruption in Phase 2
- Design server state machine carefully (see [Section 9](#9-hard-problems-interruption--buffering))
- If it becomes unmanageable, consider Pipecat as a voice-only sidecar

### Risk 3: Sentence-boundary detection

**Impact:** Bad boundaries = choppy TTS or long silences before first audio.
**Mitigation:**
- Simple regex works for 90% of cases
- `minLength` threshold prevents false splits on "Dr." / "U.S."
- Timeout flush for edge cases
- Iterate on thresholds with real usage

### Risk 4: Kokoro-FastAPI maintenance

**Impact:** 4.6k stars, but 115 open issues. Last commit Jan 2026.
**Mitigation:**
- OpenAI-compatible API means any compatible TTS server is a drop-in replacement
- Piper TTS (via Wyoming protocol or own wrapper) as backup
- The underlying Kokoro-82M model is separate from the FastAPI wrapper — can wrap it yourself if needed

### Risk 5: WebSocket reliability on mobile

**Impact:** Mobile networks drop connections.
**Mitigation:**
- Reconnection with exponential backoff
- Buffer audio locally during brief disconnects
- Show "RECONNECTING..." state
- Fall back to text mode if connection is persistently unstable

### Risk 6: Echo / feedback loop

**Impact:** TTS audio picked up by mic → sent to STT → loop.
**Mitigation:**
- `echoCancellation: true` in getUserMedia (browser handles it)
- VAD detects human speech patterns, not speaker playback (Silero is ML-based)
- Additional safeguard: pause VAD while TTS is playing (simplest, Phase 1)

---

## 17. Alternative: All-Node.js (No Python/Docker)

If you want to avoid Docker and Python entirely:

**`sherpa-onnx`** (npm v1.12.29) provides STT + TTS + VAD as a native Node.js addon. Runs in the same process as Hono.

| | Docker approach (recommended) | sherpa-onnx Node.js |
|---|---|---|
| STT speed (GPU) | Faster (CTranslate2) | Slower (ONNX Runtime, CPU mainly) |
| TTS quality | Kokoro-82M via FastAPI | Kokoro-82M via ONNX (same model) |
| GPU acceleration | Full CUDA via Docker | Limited |
| Setup | Docker + docker-compose | `npm install sherpa-onnx` |
| Deployment | 2 extra containers | Same process |
| Complexity | Moderate (HTTP between services) | Lower (in-process) |

**Recommendation:** Docker approach if you have GPU. sherpa-onnx if you want simplicity and accept CPU-only performance.

---

## 18. Rejected Alternatives & Why

### Speaches (all-in-one STT+TTS) — REJECTED

- **GitHub:** `speaches-ai/speaches` (3.1k stars)
- **Status: Effectively abandoned.** Last commit Dec 27, 2025 (3 months ago). Maintainer unresponsive. Issue #622 (March 19, 2026): user asks about development status — no response. 91 open issues, 19 unmerged PRs. Community already forking.
- **Never reached v1.0** (latest: v0.9.0-rc.3)
- **Realtime WebSocket API:** Documented but no evidence of production use by anyone
- **Why we considered it:** Single container with both STT and TTS + OpenAI-compatible API. Appealing concept ("Ollama for voice").
- **Why we rejected it:** Single-maintainer project gone dark. Cannot bet production features on it.

### Client-side WASM pipeline — REJECTED

- Kokoro-JS broken on Safari/iOS, vosk-browser abandoned, heavy model downloads for each user
- See earlier versions of this document for full analysis

### Pipecat (Python voice framework) — CONSIDERED, deferred

- Production-proven (Daily.co, millions of calls). Handles interruption, buffering, turn-taking.
- But: Python-only server. Would require rewriting Hono backend or running a Python sidecar.
- **Fallback plan:** If interruption handling in Phase 2 becomes unmanageable, add Pipecat as a voice-only microservice.

### WebRTC — REJECTED for now

- Lower transport latency (~50-150ms saved) but massive complexity (STUN/TURN, SDP, media server)
- The bottleneck is Claude API (~500-1500ms), not transport. WebSocket accounts for <5% of total latency.
- Revisit if adding video/screen-sharing to calls.

### Web Speech API / SpeechSynthesis (browser-native) — REJECTED as primary

- Inconsistent across browsers. Firefox has no STT. Safari is buggy.
- SpeechSynthesis acceptable as zero-cost TTS fallback only.

---

## 19. Sources

**STT:**
- [faster-whisper — GitHub](https://github.com/SYSTRAN/faster-whisper) — 14k+ stars, v1.2.1
- [faster-whisper — PyPI](https://pypi.org/project/faster-whisper/)
- [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) — 8x faster

**TTS:**
- [Kokoro-FastAPI — GitHub](https://github.com/remsky/Kokoro-FastAPI) — 4.6k stars
- [Kokoro-82M model](https://huggingface.co/hexgrad/Kokoro-82M)
- [Kokoro TTS Benchmarks — Inferless](https://www.inferless.com/learn/comparing-different-text-to-speech---tts--models-part-2)

**WebSocket:**
- [@hono/node-ws — npm](https://www.npmjs.com/package/@hono/node-ws) — v1.3.0
- [Hono WebSocket docs](https://hono.dev/docs/helpers/websocket)
- [@hono/node-ws message drop fix — Issue #1129](https://github.com/honojs/middleware/issues/1129)
- [Hono CORS + WebSocket conflict — Issue #4090](https://github.com/honojs/hono/issues/4090)

**Client VAD:**
- [@ricky0123/vad — GitHub](https://github.com/ricky0123/vad) — 1.9k stars
- [@ricky0123/vad-web — npm](https://www.npmjs.com/package/@ricky0123/vad-web) — v0.0.30

**Architecture:**
- [Voice Agent Architecture — LiveKit](https://livekit.com/blog/voice-agent-architecture-stt-llm-tts-pipelines-explained)
- [Voice AI Stack 2026 — AssemblyAI](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents)
- [Real-Time vs Turn-Based Voice Agents — Softcery](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture)
- [Choosing Voice AI Framework 2026 — WebRTC.ventures](https://webrtc.ventures/2026/03/choosing-a-voice-ai-agent-production-framework/)
- [WebSocket vs WebRTC for Voice — DEV](https://dev.to/nick_lackam/i-tested-our-websocket-audio-pipeline-with-webrtc-heres-why-i-switched-it-back-3g1j)
- [Barge-In for Voice Agents — Orga AI](https://orga-ai.com/blog/blog-barge-in-voice-agents-guide)
- [Browser Echo Cancellation — Chrome Blog](https://developer.chrome.com/blog/more-native-echo-cancellation)

**Rejected:**
- [Speaches — GitHub](https://github.com/speaches-ai/speaches) — abandoned, Issue #622
- [ChatGPT Voice Mode Infrastructure — GitNation](https://gitnation.com/contents/open-source-voice-ai-how-we-built-chatgpts-voice-mode-infrastructure)
- [Open WebUI voice issues — GitHub #16644](https://github.com/open-webui/open-webui/issues/16644)

**Node.js Alternative:**
- [sherpa-onnx — GitHub](https://github.com/k2-fsa/sherpa-onnx) — v1.12.31
- [sherpa-onnx — npm](https://www.npmjs.com/package/sherpa-onnx)
