import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";
import { runQuery } from "./claude.js";
import type { Session, ClientMessage, ServerMessage } from "./types.js";

const sessions = new Map<WebSocket, Session>();

function send(ws: WebSocket, payload: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function abortSession(ws: WebSocket) {
  const session = sessions.get(ws);
  if (!session) return;

  if (session.abortController) {
    session.abortController.abort();
    session.abortController = null;
    session.query = null;
  }

  for (const [, pending] of session.pendingApprovals) {
    pending.resolve({ behavior: "deny", message: "Session aborted" });
  }
  session.pendingApprovals.clear();
}

function handleToolApprovalResponse(
  ws: WebSocket,
  toolUseId: string,
  approved: boolean,
  reason?: string,
) {
  const session = sessions.get(ws);
  if (!session) return;

  const pending = session.pendingApprovals.get(toolUseId);
  if (!pending) return;

  session.pendingApprovals.delete(toolUseId);
  if (approved) {
    pending.resolve({ behavior: "allow" });
  } else {
    pending.resolve({ behavior: "deny", message: reason || "User denied" });
  }
}

async function handlePrompt(ws: WebSocket, prompt: string, sessionId?: string, workDir?: string) {
  const session = sessions.get(ws);
  if (!session) return;

  // Abort any existing query
  if (session.abortController) {
    session.abortController.abort();
    session.query = null;
    session.abortController = null;
  }

  const resumeId = sessionId || session.sessionId || undefined;
  const cwd = workDir || process.cwd();

  const abortController = await runQuery({ prompt, resumeId, cwd }, {
    onMessage: (message: SDKMessage) => {
      if ("session_id" in message && message.session_id) {
        session.sessionId = message.session_id;
      }
      send(ws, { type: "stream", data: message });
    },
    onToolApproval: (toolName, input, opts) => {
      return new Promise((resolve) => {
        session.pendingApprovals.set(opts.toolUseID, { resolve });
        send(ws, {
          type: "tool_approval_request",
          toolName,
          input,
          toolUseId: opts.toolUseID,
          title: opts.title,
          decisionReason: opts.decisionReason,
        });
      });
    },
    onDone: () => {
      send(ws, { type: "done", sessionId: session.sessionId });
      session.query = null;
      session.abortController = null;
      for (const [, pending] of session.pendingApprovals) {
        pending.resolve({ behavior: "deny", message: "Session ended" });
      }
      session.pendingApprovals.clear();
    },
    onError: (err) => {
      send(ws, { type: "error", data: err.message });
    },
  });

  session.abortController = abortController;
}

export function setupWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    logger.info("Client connected");
    sessions.set(ws, {
      query: null,
      abortController: null,
      sessionId: null,
      pendingApprovals: new Map(),
    });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", data: "Invalid JSON" });
        return;
      }

      if (msg.type === "prompt") {
        handlePrompt(ws, msg.prompt ?? "", msg.sessionId, msg.workDir);
      } else if (msg.type === "abort") {
        abortSession(ws);
      } else if (msg.type === "tool_approval_response") {
        handleToolApprovalResponse(ws, msg.toolUseId, msg.approved, msg.reason);
      }
    });

    ws.on("close", () => {
      abortSession(ws);
      sessions.delete(ws);
      logger.info("Client disconnected");
    });
  });

  return wss;
}
