import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";
import { runQuery } from "./claude.js";
import type { ToolApprovalResolver } from "./types.js";

interface ClientConnection {
  sendEvent: (event: string, data: unknown) => void;
  abortController: AbortController | null;
  sessionId: string | null;
  pendingApprovals: Map<string, ToolApprovalResolver>;
}

const clients = new Map<string, ClientConnection>();

export function registerClient(
  clientId: string,
  sendEvent: (event: string, data: unknown) => void,
) {
  const existing = clients.get(clientId);
  if (existing) {
    existing.sendEvent = sendEvent;
    logger.info(`Client reconnected: ${clientId}`);
    return;
  }
  clients.set(clientId, {
    sendEvent,
    abortController: null,
    sessionId: null,
    pendingApprovals: new Map(),
  });
  logger.info(`Client connected: ${clientId}`);
}

export function unregisterClient(clientId: string) {
  const client = clients.get(clientId);
  if (!client) return;

  if (client.abortController) {
    client.abortController.abort();
  }
  for (const [, pending] of client.pendingApprovals) {
    pending.resolve({ behavior: "deny", message: "Client disconnected" });
  }
  clients.delete(clientId);
  logger.info(`Client disconnected: ${clientId}`);
}

export async function handlePrompt(
  clientId: string,
  prompt: string,
  sessionId?: string,
  workDir?: string,
): Promise<boolean> {
  const client = clients.get(clientId);
  if (!client) return false;

  if (client.abortController) {
    client.abortController.abort();
    client.abortController = null;
  }

  const resumeId = sessionId || client.sessionId || undefined;
  const cwd = workDir || process.cwd();

  const abortController = await runQuery({ prompt, resumeId, cwd }, {
    onMessage: (message: SDKMessage) => {
      if ("session_id" in message && message.session_id) {
        client.sessionId = message.session_id;
      }
      client.sendEvent("stream", message);
    },
    onToolApproval: (toolName, input, opts) => {
      return new Promise((resolve) => {
        client.pendingApprovals.set(opts.toolUseID, { resolve });
        client.sendEvent("tool_approval", {
          toolName,
          input,
          toolUseId: opts.toolUseID,
          title: opts.title,
          decisionReason: opts.decisionReason,
        });
      });
    },
    onDone: () => {
      client.sendEvent("done", { sessionId: client.sessionId });
      client.abortController = null;
      for (const [, pending] of client.pendingApprovals) {
        pending.resolve({ behavior: "deny", message: "Session ended" });
      }
      client.pendingApprovals.clear();
    },
    onError: (err) => {
      client.sendEvent("server_error", { message: err.message });
    },
  });

  client.abortController = abortController;
  return true;
}

export function handleToolApproval(
  clientId: string,
  toolUseId: string,
  approved: boolean,
  reason?: string,
) {
  const client = clients.get(clientId);
  if (!client) return;

  const pending = client.pendingApprovals.get(toolUseId);
  if (!pending) return;

  client.pendingApprovals.delete(toolUseId);
  pending.resolve(
    approved
      ? { behavior: "allow" }
      : { behavior: "deny", message: reason || "User denied" },
  );
}

export function handleAbort(clientId: string) {
  const client = clients.get(clientId);
  if (!client) return;

  if (client.abortController) {
    client.abortController.abort();
    client.abortController = null;
  }

  for (const [, pending] of client.pendingApprovals) {
    pending.resolve({ behavior: "deny", message: "Aborted by user" });
  }
  client.pendingApprovals.clear();
}
