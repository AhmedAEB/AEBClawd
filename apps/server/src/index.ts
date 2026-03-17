import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "child_process";

const PORT = Number(process.env.PORT) || 3001;
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

const wss = new WebSocketServer({ server: httpServer });

interface Session {
  process: ChildProcess | null;
  sessionId: string | null;
}

const sessions = new Map<WebSocket, Session>();

wss.on("connection", (ws) => {
  console.log("Client connected");
  sessions.set(ws, { process: null, sessionId: null });

  ws.on("message", (raw) => {
    let msg: { type: string; prompt?: string; sessionId?: string; workDir?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", data: "Invalid JSON" }));
      return;
    }

    if (msg.type === "prompt") {
      handlePrompt(ws, msg.prompt ?? "", msg.sessionId, msg.workDir);
    } else if (msg.type === "abort") {
      abortSession(ws);
    }
  });

  ws.on("close", () => {
    abortSession(ws);
    sessions.delete(ws);
    console.log("Client disconnected");
  });
});

function handlePrompt(
  ws: WebSocket,
  prompt: string,
  sessionId?: string,
  workDir?: string
) {
  const session = sessions.get(ws);
  if (!session) return;

  // Kill any existing process
  if (session.process) {
    session.process.kill("SIGTERM");
    session.process = null;
  }

  const args = [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ];

  // Resume session if provided
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  // Add the prompt
  args.push(prompt);

  console.log(`Spawning: ${CLAUDE_PATH} ${args.join(" ")}`);

  const child = spawn(CLAUDE_PATH, args, {
    cwd: workDir || process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  session.process = child;

  let buffer = "";

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    // Stream JSON is newline-delimited
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        // Extract session ID from init message (CLI uses session_id)
        if (parsed.type === "system" && parsed.session_id) {
          session.sessionId = parsed.session_id;
        }
        if (parsed.session_id && !session.sessionId) {
          session.sessionId = parsed.session_id;
        }
        ws.send(JSON.stringify({ type: "stream", data: parsed }));
      } catch {
        // Forward raw line if not valid JSON
        ws.send(JSON.stringify({ type: "raw", data: line }));
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    console.error("Claude stderr:", text);
    ws.send(JSON.stringify({ type: "stderr", data: text }));
  });

  child.on("close", (code) => {
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        ws.send(JSON.stringify({ type: "stream", data: parsed }));
      } catch {
        ws.send(JSON.stringify({ type: "raw", data: buffer }));
      }
    }

    ws.send(
      JSON.stringify({
        type: "done",
        code,
        sessionId: session.sessionId,
      })
    );
    session.process = null;
    console.log(`Claude process exited with code ${code}`);
  });

  child.on("error", (err) => {
    ws.send(
      JSON.stringify({ type: "error", data: `Failed to spawn claude: ${err.message}` })
    );
    session.process = null;
  });
}

function abortSession(ws: WebSocket) {
  const session = sessions.get(ws);
  if (session?.process) {
    session.process.kill("SIGTERM");
    session.process = null;
  }
}

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
