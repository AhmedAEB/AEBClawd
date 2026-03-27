<div align="center">

# AEBClawd

[![License: MIT](https://img.shields.io/badge/License-MIT-000000.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-000000.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Hono](https://img.shields.io/badge/Hono-4-000000.svg?style=flat-square&logo=hono&logoColor=white)](https://hono.dev/)
[![Claude](https://img.shields.io/badge/Claude_Agent_SDK-000000.svg?style=flat-square&logo=anthropic&logoColor=white)](https://docs.anthropic.com/)
[![pnpm](https://img.shields.io/badge/pnpm-9+-000000.svg?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)

**A self-hosted web interface for Claude Code — use it from anywhere, on any device.**

[Deploy to VPS](#deploy-to-vps) · [Local Development](#local-development) · [Features](#features) · [API Reference](#api-endpoints) · [Voice Mode](#voice-mode) · [Configuration](#configuration)

</div>

---

## Overview

AEBClawd lets you interact with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) through a browser, mobile app, or chat platform. It provides real-time streaming chat, workspace management, session persistence, git operations, voice mode, and tool approval workflows — all wrapped in a minimal, brutalist UI.

## Features

- **Real-time streaming chat** — Talk to Claude Code via Server-Sent Events with live message streaming
- **Workspace management** — Browse, create, and organize project directories
- **Session persistence** — Save, resume, and review past conversations with full history
- **Tool approval** — Approve or deny Claude's tool usage in real-time, with optional input modification
- **Git integration** — Stage, commit, push, pull, branch, diff, and view status from the UI
- **Voice mode** — Speech-to-Text (Whisper) and Text-to-Speech (Kokoro) via WebSocket
- **Mobile app** — iOS and Android support via Expo / React Native
- **Multi-platform bots** — Deploy Claude to Slack, Discord, Teams, Telegram, and GitHub
- **Markdown rendering** — Rich display of assistant responses with code blocks, tables, and GFM support
- **Minimalist UI** — Black and white brutalist design, sharp corners, no visual noise

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, TypeScript |
| Backend | Node.js, Hono, TypeScript |
| AI | Anthropic Claude Agent SDK |
| Mobile | Expo 55, React Native 0.83 |
| Bots | Slack, Discord, Teams, Telegram, GitHub (via chat-adapter) |
| Voice | Whisper STT, Kokoro TTS (Docker) |
| Monorepo | pnpm workspaces |

## Deploy to VPS

The recommended way to run AEBClawd in production. A single command sets up everything on a fresh Ubuntu/Debian VPS with an interactive setup wizard.

```bash
bash <(curl -fsSL https://install.aebclawd.com)
```

The installer will:

1. Install Node.js 20, pnpm, and system dependencies
2. Clone the repository to `/opt/aebclawd`
3. Launch an interactive TUI wizard that walks you through:
   - Domain configuration (HTTPS via Caddy, or IP-only mode)
   - Anthropic API key
   - Basic auth credentials
   - Voice mode (optional, requires Docker)
   - Bot integrations (Telegram, Slack, Discord, Teams, GitHub)
4. Build all services and start them via systemd
5. Configure Caddy reverse proxy with automatic HTTPS
6. Set up UFW firewall (ports 22, 80, 443)

### Requirements

- Ubuntu or Debian VPS (2GB+ RAM, 10GB+ disk)
- Root access
- Domain pointed at the VPS (optional — IP-only mode available for testing)

### Management

```bash
# Update to latest version
sudo /opt/aebclawd/deploy/update.sh

# Reconfigure settings
sudo node /opt/aebclawd/deploy/setup/dist/index.js

# View logs
journalctl -u aebclawd-server -f
journalctl -u aebclawd-frontend -f

# Restart services
sudo systemctl restart aebclawd-server aebclawd-frontend

# Uninstall
sudo /opt/aebclawd/deploy/uninstall.sh
```

### Why VPS over PaaS?

AEBClawd runs Claude Code, which installs packages, writes files, and executes commands. On platforms like Railway or Render, the filesystem is ephemeral — everything Claude installs disappears on the next deploy. A VPS gives you a persistent filesystem where runtime changes survive restarts and updates.

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9+)
- An [Anthropic API key](https://console.anthropic.com/)
- [Docker](https://www.docker.com/) (optional, for voice mode)
- [Expo CLI](https://docs.expo.dev/) (optional, for mobile development)

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/AEBClawd.git
cd AEBClawd
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
WORKSPACES_ROOT="/path/to/your/workspaces"
ANTHROPIC_API_KEY="your-api-key"
```

### 4. Start development servers

```bash
pnpm dev
```

This starts the frontend, server, and bot concurrently:

| Service | URL |
|---------|-----|
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:3001` |

You can also run services individually:

```bash
pnpm frontend:dev     # Frontend only
pnpm server:dev       # Backend only
pnpm bot:dev          # Bot only
pnpm mobile:dev       # Mobile (Expo)
pnpm mobile:ios       # Build and run on iOS
pnpm mobile:android   # Build and run on Android
```

### 5. Build for production

```bash
# Build the server
cd apps/server && pnpm build

# Build the frontend
cd apps/frontend && pnpm build

# Start production servers
cd apps/server && pnpm start
cd apps/frontend && pnpm start
```

## Project Structure

```
AEBClawd/
├── apps/
│   ├── frontend/             # Next.js web application
│   │   └── src/
│   │       ├── app/
│   │       │   └── workspaces/    # Workspace routes (browse, sessions, chat)
│   │       └── components/        # Shared UI components
│   ├── server/               # Hono API server
│   │   └── src/
│   │       ├── lib/               # Core modules (claude, session, git, voice, tts, stt)
│   │       └── routes/            # API routes (stream, sessions, filesystem, git, voice, models)
│   ├── mobile/               # Expo / React Native app (iOS & Android)
│   └── bot/                  # Multi-platform chatbot (Slack, Discord, Teams, Telegram, GitHub)
├── packages/
│   └── core/                 # Shared library (Claude SDK wrapper, paths, env, logger)
├── deploy/
│   ├── install.sh            # One-command VPS installer (curl target)
│   ├── update.sh             # Pull, rebuild, restart
│   ├── uninstall.sh          # Clean removal
│   └── setup/                # Interactive TUI wizard (Ink/React)
│       └── src/
│           ├── screens/           # 9 wizard screens (welcome → done)
│           ├── components/        # Reusable TUI components
│           ├── hooks/             # State management (useReducer)
│           └── lib/               # System commands, generators
├── docker/
│   └── stt/                  # Speech-to-Text Docker image (Whisper)
├── docker-compose.yml        # Voice services (STT & TTS, GPU/CPU variants)
├── CLAUDE.md                 # Project guidelines and design standards
├── package.json              # Root workspace configuration
└── pnpm-workspace.yaml
```

## API Endpoints

### Stream

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stream` | Establish SSE connection |
| `POST` | `/api/stream/prompt` | Send a prompt to Claude |
| `POST` | `/api/stream/tool-approval` | Approve or deny tool usage |
| `POST` | `/api/stream/abort` | Abort the current query |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List saved sessions |
| `GET` | `/api/sessions/:id/messages` | Get session messages (supports pagination) |

### Filesystem

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/filesystem` | List directories |
| `POST` | `/api/filesystem/mkdir` | Create a directory |
| `POST` | `/api/filesystem/rmdir` | Remove a directory |

### Git

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/git/status` | Get staged, unstaged, and untracked files |
| `GET` | `/api/git/log` | Get commit log with graph |
| `GET` | `/api/git/diff` | Get diff for a file |
| `GET` | `/api/git/sync-status` | Check ahead/behind counts |
| `GET` | `/api/git/branches` | List local and remote branches |
| `POST` | `/api/git/stage` | Stage files |
| `POST` | `/api/git/unstage` | Unstage files |
| `POST` | `/api/git/commit` | Create a commit |
| `POST` | `/api/git/push` | Push to remote |
| `POST` | `/api/git/pull` | Pull from remote |
| `POST` | `/api/git/checkout` | Checkout a branch |
| `POST` | `/api/git/create-branch` | Create a new branch |
| `POST` | `/api/git/discard` | Discard file changes |

### Models

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models` | List available AI models |

### Voice

| Protocol | Endpoint | Description |
|----------|----------|-------------|
| WebSocket | `/ws/voice` | Voice mode (STT, TTS, Claude streaming) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |

## Voice Mode

Voice mode provides a real-time conversational experience using Speech-to-Text and Text-to-Speech services running in Docker.

### Setup

Start the voice services using Docker Compose:

```bash
# GPU-accelerated (recommended)
docker compose --profile gpu up -d

# CPU-only fallback
docker compose --profile cpu up -d
```

This starts:
- **STT** (port 8001) — Whisper-based speech recognition via `faster-whisper`
- **TTS** (port 8880) — Kokoro-based speech synthesis

Set the service URLs in your environment:

```env
STT_URL="http://localhost:8001"
TTS_URL="http://localhost:8880"
```

### How It Works

1. Client connects via WebSocket to `/ws/voice`
2. Audio is streamed to the server and transcribed via the STT service
3. Transcripts are sent to Claude for processing
4. Claude's response is streamed through a sentence buffer
5. Each sentence is converted to speech via the TTS service
6. Audio is sent back to the client in real-time

## How It Works

1. **Select a workspace** — pick or create a project directory
2. **Start chatting** — new session or resume an existing one
3. **Stream in real-time** — prompts go to the backend, which invokes Claude via the Agent SDK
4. **Approve tools** — when Claude wants to run a tool, you approve or deny it
5. **Manage git** — stage, commit, push, pull, and branch from the UI
6. **Resume anytime** — sessions are persisted automatically

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKSPACES_ROOT` | Yes | — | Root directory for workspace browsing |
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key |
| `PORT` | No | `3001` | Backend server port |
| `NEXT_PUBLIC_API_URL` | No | `""` (relative) | Backend URL for the frontend (set for local dev, leave empty behind a reverse proxy) |
| `STT_URL` | No | — | Speech-to-Text service URL |
| `TTS_URL` | No | — | Text-to-Speech service URL |

### Bot Configuration

Each bot platform requires its own credentials:

| Variable | Platform |
|----------|----------|
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Slack |
| `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY` | Discord |
| `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD` | Microsoft Teams |
| `TELEGRAM_BOT_TOKEN` | Telegram |
| `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET` | GitHub |

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

[MIT](LICENSE)
