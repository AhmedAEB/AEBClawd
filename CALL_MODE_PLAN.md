# Call Mode — Implementation Plan

> A continuous, hands-free voice conversation with Claude. Coexists with the existing Voice Mode (click-to-talk). The user starts a call, speaks naturally, and the system auto-detects when they stop, transcribes, sends to Claude, plays back the response, then listens again. No buttons needed after starting.
>
> **Validated:** March 25, 2026 — all decisions double-checked against production best practices, competitor implementations, and library source code.

---

## How It Differs from Existing Voice Mode

| Feature | Voice Mode (existing) | Call Mode (new) |
|---------|----------------------|-----------------|
| Input method | Click to start/stop recording | Automatic — VAD detects speech start/end |
| User action | Click CLICK TO TALK, speak, click CLICK TO STOP | Just speak |
| Conversation flow | One turn at a time, manual | Continuous loop — auto-listens after AI responds |
| During AI response | User waits, clicks again to talk | System pauses listening, resumes when AI finishes |
| Button | Toggle recording button | Only START CALL / END CALL |
| Best for | Noisy environments, precise control | Quiet environments, natural conversation |

**Both modes share the same backend pipeline** (WebSocket → STT → Claude → TTS → audio back). The difference is entirely in how the frontend captures and sends audio.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  BROWSER                                            │
│                                                     │
│  ┌─────────────┐                                    │
│  │  MicVAD     │  ← @ricky0123/vad-web              │
│  │  (Silero v5)│  ← Runs continuously               │
│  │             │  ← Auto-detects speech start/end    │
│  │  onSpeechEnd│──► Float32Array (16kHz mono)        │
│  └─────────────┘          │                          │
│                           │ convert to WAV           │
│                           ▼                          │
│                    WebSocket binary frame             │
│                    (server uses state to detect       │
│                     VAD vs PTT audio)                │
│                           │                          │
│  ┌─────────────┐          │     ┌────────────────┐   │
│  │ Web Audio   │◄─────────┼─────│ TTS audio back │   │
│  │ playback    │          │     └────────────────┘   │
│  └──────┬──────┘          │                          │
│         │                 │                          │
│  When playback active:    │                          │
│  → isTtsPlaying = true    │                          │
│  → Ignore VAD events      │                          │
│  When all audio finished: │                          │
│  → isTtsPlaying = false   │                          │
│  → Resume accepting VAD   │                          │
└───────────────────────────┼──────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Hono Backend  │  ← Same /ws/voice endpoint
                    │                │  ← Same pipeline as voice mode
                    │  STT → Claude  │
                    │  → TTS → back  │
                    └────────────────┘
```

---

## Technical Decisions (Validated)

### VAD: @ricky0123/vad-web v0.0.30 with Silero v5

| Detail | Value | Source |
|--------|-------|--------|
| npm version | 0.0.30 | npm registry, verified |
| `onSpeechEnd` output | `Float32Array` at 16kHz mono | Source code verified |
| Silence threshold param | `redemptionMs` (milliseconds) | API docs + source |
| Default silence threshold | 1400ms | Source code |
| `pause()` / `start()` | Return `Promise<void>` | v0.0.30 changelog |
| onnxruntime-web dep | Regular dep, `^1.17.0` | package.json |
| Memory leak | Fixed in v0.0.30 | Release notes |
| **Model** | **Silero v5** (not legacy) | v5 is 3x faster, 6000+ languages |

**Use `model: "v5"`** — ships with vad-web v0.0.30. Copy `silero_vad_v5.onnx` (not legacy) to `public/vad/`.

**Recommended config:**
```typescript
{
  model: "v5",                      // 3x faster than legacy
  positiveSpeechThreshold: 0.5,     // v5 needs higher thresholds than legacy
  negativeSpeechThreshold: 0.35,    // v5 calibrated values
  redemptionMs: 800,                // 800ms silence = turn complete
  preSpeechPadMs: 300,              // capture 300ms before speech onset
  minSpeechMs: 250,                 // ignore segments < 250ms
  submitUserSpeechOnPause: false,
}
```

**Why not alternatives:**
- Picovoice Cobra: requires license key, not free
- Silero v6: vad-web only ships v5, using v6 directly would need custom tensor handling
- WebGPU VAD: doesn't exist yet
- Pipecat/LiveKit: require full architecture rewrite

### Audio Format: Float32Array → WAV (client-side)

Write a ~30 line utility. No npm package needed (`audiobuffer-to-wav` is unmaintained since 2015). WAV is the ideal input for faster-whisper (matches 16kHz natively, no resampling).

### Next.js + Turbopack: public/ directory approach

`copy-webpack-plugin` does NOT work with Turbopack. Copy assets to `public/vad/` via postinstall script. Configure `MicVAD` with `baseAssetPath: "/vad/"`.

**Files to copy:**
```
node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx     → public/vad/
node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js → public/vad/
node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm → public/vad/
node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm          → public/vad/
node_modules/onnxruntime-web/dist/ort-wasm.wasm                → public/vad/
node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs  → public/vad/
```

**COOP/COEP headers** — required for SharedArrayBuffer (multi-threaded ONNX). Add to `next.config.ts`:
```typescript
async headers() {
  return [{
    source: "/(.*)",
    headers: [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ],
  }];
}
```

Use `credentialless` (not `require-corp`) — less restrictive, won't break third-party resources.

**Alternative:** If headers cause issues, force single-threaded mode with `ort.env.wasm.numThreads = 1` before VAD init. Slightly slower but avoids header requirement.

### Echo Cancellation: Client-Side Playback Tracking

**NOT using server-side `tts_start`/`tts_end`** for echo gating — the server sends `tts_end` after sending audio bytes, but the client hasn't *played* them yet. This creates a race condition where the echo gate opens while audio is still playing.

**Correct approach:** Track playback state entirely on the client:

```typescript
// In use-call-mode.ts
const isTtsPlayingRef = useRef(false);
const activeAudioCountRef = useRef(0);

// When receiving TTS audio binary:
activeAudioCountRef.current++;
isTtsPlayingRef.current = true;
const source = playPcmChunk(audioData);
source.onended = () => {
  activeAudioCountRef.current--;
  if (activeAudioCountRef.current <= 0) {
    // Add 200ms buffer for room reverberation
    setTimeout(() => {
      if (activeAudioCountRef.current <= 0) {
        isTtsPlayingRef.current = false;
      }
    }, 200);
  }
};

// VAD callback:
onSpeechEnd: (audio) => {
  if (isTtsPlayingRef.current) return; // echo gate
  sendAudioToServer(audio);
}
```

This ensures the echo gate stays closed until ALL audio chunks have finished playing + 200ms buffer.

### Message Protocol: No Separate JSON for VAD Audio

**Eliminated the `{ type: "vad_audio" }` JSON message.** Instead, the server uses session state to distinguish VAD vs PTT binary frames:

```typescript
// Server: voice.ts binary handler
if (event.data instanceof ArrayBuffer) {
  const session = getVoiceSession(clientId);
  if (session.mode === "call") {
    // Call mode: binary = complete VAD utterance, run pipeline immediately
    session.audioChunks = [Buffer.from(event.data)];
    runVoicePipeline(session, ws);
  } else {
    // Voice mode: binary = PTT chunk, accumulate
    session.audioChunks.push(Buffer.from(event.data));
  }
}
```

No new message types needed. The `start_call` message sets `session.mode = "call"` or `"voice"` based on which mode the user activated.

### Silence Threshold: 800ms

| Platform | Default silence | Notes |
|----------|----------------|-------|
| OpenAI Realtime API | 500ms | Aggressive, can clip pauses |
| LiveKit VoicePipeline | 500-600ms | With semantic fallback |
| AssemblyAI | 160ms (confident) / 2400ms (uncertain) | Hybrid semantic + silence |
| **Our default** | **800ms** | Conservative but responsive |

800ms is slightly more conservative than OpenAI's 500ms — fewer false cuts at the cost of ~300ms extra latency per turn. Good default for natural conversation.

---

## State Machine

```
IDLE ──── startCall() ────► LISTENING
                                │
                          onSpeechEnd(audio)
                          (only if !isTtsPlaying)
                                │
                                ▼
                           PROCESSING ─── Claude first token ──► SPEAKING
                                ▲                                    │
                                │                              All audio played
                                │                              + 200ms buffer
                                │                                    │
                                └────────────────────────────────────┘
                                         (auto-loop back)

endCall() from any state ──► IDLE
```

---

## What Changes

### New npm package

| Package | Version | Purpose |
|---------|---------|---------|
| `@ricky0123/vad-web` | ^0.0.30 | Browser VAD (Silero v5 via ONNX) |

### New files

| File | Purpose |
|------|---------|
| `apps/frontend/src/hooks/use-call-mode.ts` | Call mode hook — VAD lifecycle, auto-listen loop, echo gate |
| `apps/frontend/src/components/call-mode.tsx` | Call mode UI — CallProvider, CallButton, CallPanel |
| `apps/frontend/src/lib/float32-to-wav.ts` | Float32Array → WAV conversion (~30 lines) |
| `apps/frontend/public/vad/*` | ONNX model + worklet + WASM files |

### Modified files

| File | Change |
|------|--------|
| `apps/frontend/package.json` | Add `@ricky0123/vad-web`, add `postinstall` script |
| `apps/frontend/next.config.ts` | Add COOP/COEP headers for SharedArrayBuffer |
| `apps/frontend/src/app/workspaces/[...path]/chat-view.tsx` | Import CallProvider/CallButton/CallPanel alongside voice mode |
| `apps/server/src/routes/voice.ts` | Detect call vs voice mode from session state for binary handling |
| `apps/server/src/lib/voice-types.ts` | Add `mode: "voice" \| "call"` to `VoiceSession` |
| `apps/server/src/lib/voice-session.ts` | Store `mode` in session |
| `apps/server/src/lib/stt-client.ts` | Support `audio/wav` MIME type alongside `audio/webm` |
| `apps/frontend/src/hooks/use-audio-playback.ts` | Return `AudioBufferSourceNode` from `playPcmChunk` for tracking |

### NOT modified (existing voice mode untouched)

- `apps/frontend/src/hooks/use-voice.ts` — click-to-talk stays
- `apps/frontend/src/components/voice-mode.tsx` — VoiceProvider/VoiceButton/VoicePanel stay
- `apps/server/src/lib/voice-pipeline.ts` — reused as-is
- `apps/server/src/lib/tts-client.ts` — reused as-is
- `apps/server/src/lib/sentence-buffer.ts` — reused as-is

---

## Implementation Order

### Step 1: Frontend infrastructure
1. `pnpm add @ricky0123/vad-web` in `apps/frontend`
2. Create postinstall script to copy VAD assets to `public/vad/`
3. Add COOP/COEP headers to `next.config.ts`
4. Create `apps/frontend/src/lib/float32-to-wav.ts`

### Step 2: Backend updates
5. Add `mode` field to `VoiceSession` in `voice-types.ts` and `voice-session.ts`
6. Update binary handler in `voice.ts` to detect call vs voice mode
7. Update `stt-client.ts` to support `audio/wav` MIME type

### Step 3: Call mode hook
8. Create `apps/frontend/src/hooks/use-call-mode.ts`
9. Update `use-audio-playback.ts` to return source nodes for playback tracking

### Step 4: Call mode UI + integration
10. Create `apps/frontend/src/components/call-mode.tsx`
11. Integrate into `chat-view.tsx`

---

## UI Design

### Input Row (when not in a call)

```
[image] [voice-mic] [call-icon] [textarea...] [Send]
```

- **Voice mic** (existing) — microphone icon, starts click-to-talk
- **Call icon** (new) — headset/phone icon, starts continuous call mode

### Call Panel (when in call) — above input area

```
┌───────────────────────────────────────────────────────┐
│  ● LISTENING                          [MUTE] [END]   │
└───────────────────────────────────────────────────────┘
```

Minimal — no recording button. States cycle automatically:
- **● LISTENING** — pulsing dot
- **● HEARING** — solid dot (VAD detected speech start)
- **● PROCESSING** — bouncing dots
- **● SPEAKING** — solid dot, Claude is talking

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| VAD triggers on background noise | Medium | `minSpeechMs: 250` + `positiveSpeechThreshold: 0.5` filter noise. User can use voice mode instead. |
| User pauses mid-sentence, system sends too early | Medium | `redemptionMs: 800` gives 800ms grace. Can be tuned to 1000ms+. |
| Echo causes false triggers during TTS | Low | Client-side playback tracking with 200ms buffer. Browser `echoCancellation: true`. |
| COOP/COEP headers break third-party resources | Low | Using `credentialless` (not `require-corp`). Alternative: `numThreads = 1`. |
| Long call sessions leak memory | Low | v0.0.30 fixed main leak. Monitor; can destroy/recreate MicVAD between turns if needed. |
| ONNX files fail to load from public/ | Low | Serve with correct paths; no Turbopack interference with static files. |

---

## What's NOT in This Plan

- **Barge-in** — user interrupting AI mid-speech. Echo gate blocks this. Add later by allowing high-confidence (>0.7) speech events through during TTS.
- **Streaming STT** — sending audio as user speaks (before speech ends). Reduces latency but adds complexity.
- **Semantic endpointing** — using transcript analysis to detect turn completion. Pure silence-based for now.
- **Sensitivity slider** — exposing `redemptionMs` to the user. Can add later.

---

## Sources

- [@ricky0123/vad-web v0.0.30 — npm](https://www.npmjs.com/package/@ricky0123/vad-web)
- [VAD API docs](https://docs.vad.ricky0123.com/user-guide/api/)
- [Silero v5 documentation](https://docs.vad.ricky0123.com/user-guide/silero-v5/)
- [VAD v0.0.30 release notes](https://github.com/ricky0123/vad/releases)
- [VAD + Next.js (Issue #106)](https://github.com/ricky0123/vad/issues/106)
- [VAD pause/resume behavior (Issue #71)](https://github.com/ricky0123/vad/issues/71)
- [OpenAI Realtime API VAD docs (500ms default)](https://platform.openai.com/docs/guides/realtime-vad)
- [AssemblyAI: Endpointing for Voice Agents](https://www.assemblyai.com/blog/turn-detection-endpointing-voice-agent)
- [LiveKit: Turn Detection](https://docs.livekit.io/agents/build/turns/)
- [Deepgram: Echo Cancellation](https://developers.deepgram.com/docs/voice-agent-echo-cancellation)
- [Pipecat Echo Cancellation (Issue #670)](https://github.com/pipecat-ai/pipecat/issues/670)
- [onnxruntime SharedArrayBuffer requirement](https://github.com/microsoft/onnxruntime/issues/25666)
- [COOP/COEP credentialless — web.dev](https://web.dev/articles/coop-coep)
- [faster-whisper accepts ndarray](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)
