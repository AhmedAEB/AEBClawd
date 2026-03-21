<div align="center">

# AEBClawd

[![License: MIT](https://img.shields.io/badge/License-MIT-000000.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-000000.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Hono](https://img.shields.io/badge/Hono-4-000000.svg?style=flat-square&logo=hono&logoColor=white)](https://hono.dev/)
[![Claude](https://img.shields.io/badge/Claude_Agent_SDK-000000.svg?style=flat-square&logo=anthropic&logoColor=white)](https://docs.anthropic.com/)
[![pnpm](https://img.shields.io/badge/pnpm-9+-000000.svg?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)

**A self-hosted web interface for Claude Code — use it from anywhere, on any device.**

[Getting Started](#getting-started) · [Features](#features) · [API Reference](#api-endpoints) · [Configuration](#configuration)

</div>

---

## Overview

AEBClawd lets you interact with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) through a browser. It provides real-time streaming chat, workspace management, session persistence, and tool approval workflows — all wrapped in a minimal, brutalist UI.

## Features

- **Real-time streaming chat** — Talk to Claude Code via Server-Sent Events with live message streaming
- **Workspace management** — Browse, create, and organize project directories
- **Session persistence** — Save, resume, and review past conversations with full history
- **Tool approval** — Approve or deny Claude's tool usage in real-time, with optional input modification
- **Markdown rendering** — Rich display of assistant responses with code blocks, tables, and GFM support
- **Minimalist UI** — Black and white brutalist design, sharp corners, no visual noise

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, TypeScript |
| Backend | Node.js, Hono, TypeScript |
| AI | Anthropic Claude Agent SDK |
| Monorepo | pnpm workspaces |

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9+)
- An [Anthropic API key](https://console.anthropic.com/)

## Getting Started

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
```

Set your Anthropic API key as an environment variable:

```bash
export ANTHROPIC_API_KEY="your-api-key"
```

### 4. Start development servers

```bash
pnpm dev
```

This starts both servers concurrently:

| Service | URL |
|---------|-----|
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:3001` |

You can also run them individually:

```bash
pnpm frontend:dev   # Frontend only
pnpm server:dev     # Backend only
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
│   ├── frontend/          # Next.js application
│   │   └── src/
│   │       ├── app/
│   │       │   ├── workspaces/   # Workspace routes (browse, sessions, chat)
│   │       │   └── globals.css   # Theme and design tokens
│   │       └── components/       # Shared components
│   └── server/            # Hono API server
│       └── src/
│           ├── lib/              # Core modules (claude, session, env, paths)
│           └── routes/           # API routes (stream, sessions, filesystem)
├── assets/                # Logo and static assets
├── CLAUDE.md              # Project guidelines and design standards
├── package.json           # Root workspace configuration
└── pnpm-workspace.yaml
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/stream` | Establish SSE connection |
| `POST` | `/api/stream/prompt` | Send a prompt to Claude |
| `POST` | `/api/stream/tool-approval` | Approve or deny tool usage |
| `POST` | `/api/stream/abort` | Abort the current query |
| `GET` | `/api/sessions` | List saved sessions |
| `GET` | `/api/sessions/:id/messages` | Get session messages |
| `GET` | `/api/filesystem` | List directories |
| `POST` | `/api/filesystem/mkdir` | Create a directory |
| `POST` | `/api/filesystem/rmdir` | Remove a directory |

## How It Works

1. **Select a workspace** — pick or create a project directory
2. **Start chatting** — new session or resume an existing one
3. **Stream in real-time** — prompts go to the backend, which invokes Claude via the Agent SDK
4. **Approve tools** — when Claude wants to run a tool, you approve or deny it
5. **Resume anytime** — sessions are persisted automatically

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKSPACES_ROOT` | Yes | — | Root directory for workspace browsing |
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key |
| `PORT` | No | `3001` | Backend server port |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | Backend URL for the frontend |

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

[MIT](LICENSE)
