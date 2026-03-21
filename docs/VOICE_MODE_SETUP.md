# Voice Mode — Setup Guide

Everything you need to get AEBClawd's voice mode running.

---

## Prerequisites

- **Node.js** v20+
- **pnpm** v9+
- **Docker Desktop** installed and running
- **Anthropic API key** — set via `export ANTHROPIC_API_KEY="sk-ant-..."` in your shell profile (`~/.zshrc` or `~/.bash_profile`), or add it to `.env`

---

## 1. Install Dependencies

```bash
cd /path/to/AEBClawd

# Install all workspace packages
pnpm install
```

The backend already has `@hono/node-ws` installed. No additional frontend packages are needed for Phase 1.

---

## 2. Start Docker Containers (STT + TTS)

Voice mode requires two Docker services:

| Service | Purpose | Port | Image |
|---------|---------|------|-------|
| **STT** (faster-whisper) | Speech-to-text — transcribes user's voice | 8001 | Custom build from `docker/stt/` |
| **TTS** (Kokoro-FastAPI) | Text-to-speech — reads Claude's response aloud | 8880 | `ghcr.io/remsky/kokoro-fastapi-cpu` |

### Without GPU (most laptops)

```bash
docker compose --profile cpu up -d
```

### With NVIDIA GPU (production servers)

```bash
# One-time: install NVIDIA Container Toolkit on the host
# See: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html

docker compose --profile gpu up -d
```

### Verify containers are healthy

```bash
# STT health check
curl http://localhost:8001/health
# Expected: {"status":"ok","model":"Systran/faster-distil-whisper-small.en","device":"cpu"}

# TTS docs page (should open in browser too)
curl -s http://localhost:8880/docs | head -3
# Expected: HTML output (Swagger UI)
```

First startup takes a few minutes — the STT container downloads the Whisper model (~500MB) and the TTS container downloads Kokoro (~160MB). Subsequent starts are instant (cached in Docker volumes).

---

## 3. Configure Environment

Edit `.env` in the project root:

```env
WORKSPACES_ROOT="/path/to/your/projects"

# Voice mode — uncomment these when Docker containers are running
STT_URL=http://localhost:8001
TTS_URL=http://localhost:8880
# TTS_VOICE=af_heart
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKSPACES_ROOT` | Yes | — | Root directory for project workspaces |
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key (can be in `.env` or shell profile) |
| `STT_URL` | No | `""` (mock mode) | URL of the faster-whisper STT service |
| `TTS_URL` | No | `""` (mock mode) | URL of the Kokoro-FastAPI TTS service |
| `TTS_VOICE` | No | `af_heart` | Kokoro voice ID (see voice list below) |

### Mock mode (no Docker)

If you leave `STT_URL` and `TTS_URL` empty (or commented out), voice mode still works in a limited way:
- Audio recording is ignored (no STT to transcribe it)
- You can type in the voice panel text input instead
- Claude's response is displayed as text
- Browser `SpeechSynthesis` reads the response aloud (quality varies by browser)

### Available Kokoro voices

| Voice ID | Description |
|----------|-------------|
| `af_heart` | American female, warm (default) |
| `af_bella` | American female, clear |
| `am_adam` | American male |
| `am_michael` | American male, deeper |
| `bf_emma` | British female |
| `bm_george` | British male |

---

## 4. Start the App

```bash
# Terminal 1 — Backend
cd apps/server
pnpm dev

# Terminal 2 — Frontend
cd apps/frontend
pnpm dev
```

Or from the project root:

```bash
pnpm dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- STT: http://localhost:8001
- TTS: http://localhost:8880

---

## 5. Using Voice Mode

1. Open a workspace in the browser (e.g., `http://localhost:3000/workspaces/MyProject/sessions/new`)
2. In the chat input row, click the **mic icon** (between the image attach button and the textarea)
3. The **voice panel** appears above the input with:
   - **CLICK TO TALK** button — click to start recording, click again to stop
   - **Text input** — type here to send text through the voice pipeline
   - **MUTE / UNMUTE** — toggle Claude's voice output
   - **END** — close the voice session
4. Click **CLICK TO TALK**, speak, then click **CLICK TO STOP**
5. Your audio is sent to faster-whisper → transcribed → sent to Claude → Claude responds → Kokoro speaks the response
6. The transcript appears in the voice panel and in the main chat history
7. You can **type in the regular chat input** at any time during a voice call — text chat still works normally

---

## Architecture Overview

```
Browser (thin client)
  ├── Mic capture (getUserMedia)
  ├── Audio recording (MediaRecorder)
  ├── Audio playback (Web Audio API)
  └── WebSocket connection to /ws/voice
         │
         ▼
Hono Backend (Node.js, port 3001)
  ├── /ws/voice — WebSocket endpoint for voice
  ├── /api/stream — SSE endpoint for text chat (existing)
  ├── Orchestrates: audio → STT → Claude → TTS → audio back
  └── Claude Agent SDK (text only)
         │                    │
         ▼                    ▼
  faster-whisper         Kokoro-FastAPI
  (Docker, port 8001)    (Docker, port 8880)
  Audio → Text           Text → Audio
```

- Voice and text chat share the same Claude session (`sessionId`)
- The browser sends audio over WebSocket as binary frames
- The server transcribes via STT, sends text to Claude, buffers response into sentences, generates TTS audio per sentence, streams audio back
- Tool approvals during voice calls are auto-allowed (Phase 1 limitation)

---

## File Structure (voice-related files)

### Backend (`apps/server/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | WebSocket route mounted here (`/ws/voice`) |
| `routes/voice.ts` | WebSocket message handler |
| `lib/voice-types.ts` | TypeScript types for voice messages |
| `lib/voice-session.ts` | Per-connection voice state management |
| `lib/voice-pipeline.ts` | Core orchestration: STT → Claude → TTS |
| `lib/sentence-buffer.ts` | Buffers Claude tokens into sentences for TTS |
| `lib/stt-client.ts` | HTTP client for faster-whisper |
| `lib/tts-client.ts` | HTTP client for Kokoro-FastAPI |
| `lib/env.ts` | Environment variable validation (includes voice vars) |

### Frontend (`apps/frontend/src/`)

| File | Purpose |
|------|---------|
| `components/voice-mode.tsx` | Voice UI: VoiceProvider, VoiceButton, VoicePanel |
| `hooks/use-voice.ts` | Voice logic: WebSocket, recording, state machine |
| `hooks/use-audio-playback.ts` | Web Audio API playback + SpeechSynthesis fallback |
| `app/workspaces/[...path]/chat-view.tsx` | Integration point (imports voice components) |

### Docker (`docker/`)

| File | Purpose |
|------|---------|
| `docker-compose.yml` (project root) | GPU and CPU profiles for STT + TTS |
| `docker/stt/Dockerfile` | Multi-stage build for faster-whisper (GPU + CPU) |
| `docker/stt/server.py` | Minimal FastAPI wrapper for faster-whisper |

---

## Troubleshooting

### "No STT service available"
- Docker containers aren't running, or `STT_URL` is not set in `.env`
- Run `docker compose --profile cpu up -d` and set `STT_URL=http://localhost:8001`
- Restart the Hono server after changing `.env`

### Mic permission denied
- Chrome: click the lock icon in the address bar → Microphone → Allow
- Or go to `chrome://settings/content/microphone` and add `http://localhost:3000`

### WebSocket closes immediately (code 1005)
- Make sure the Hono server was restarted after code changes
- Check the server console for errors

### STT returns 500 error
- Check container logs: `docker logs aebclawd-stt-cpu-1 --tail 20`
- The STT container may still be loading the model (takes ~30s on first start)

### No audio playback from Claude
- Check that `TTS_URL=http://localhost:8880` is set and the TTS container is running
- Check if MUTE is toggled on in the voice panel
- In mock mode (no TTS), the browser uses SpeechSynthesis — quality varies

### Rebuild STT container after code changes
```bash
docker compose --profile cpu up -d --build stt-cpu
```

### Stop all Docker containers
```bash
docker compose --profile cpu down
```

### View container logs
```bash
docker logs aebclawd-stt-cpu-1 --tail 50
docker logs aebclawd-tts-cpu-1 --tail 50
```

---

## What's Coming (Phase 2)

- VAD auto-detection (no need to click talk button — auto-detects speech)
- Barge-in (interrupt Claude mid-response by speaking)
- Waveform visualization
- Voice selector UI
- Keyboard shortcut (hold Space to talk)

---

## Quick Start Checklist

```
[ ] pnpm install
[ ] docker compose --profile cpu up -d
[ ] curl http://localhost:8001/health  → ok
[ ] curl http://localhost:8880/docs    → ok
[ ] Set STT_URL and TTS_URL in .env
[ ] Set ANTHROPIC_API_KEY (env or .env)
[ ] pnpm dev (both apps)
[ ] Open http://localhost:3000, go to a workspace
[ ] Click mic icon → CLICK TO TALK → speak → CLICK TO STOP
[ ] See transcript + hear Claude respond
```
