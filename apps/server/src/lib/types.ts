import type { Query } from "@anthropic-ai/claude-agent-sdk";

export type ToolApprovalResult =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

export type ToolApprovalResolver = {
  resolve: (result: ToolApprovalResult) => void;
};

export interface Session {
  query: Query | null;
  abortController: AbortController | null;
  sessionId: string | null;
  pendingApprovals: Map<string, ToolApprovalResolver>;
}

export type ClientMessage =
  | { type: "prompt"; prompt?: string; sessionId?: string; workDir?: string }
  | { type: "abort" }
  | { type: "tool_approval_response"; toolUseId: string; approved: boolean; reason?: string };

export type ServerMessage =
  | { type: "stream"; data: unknown }
  | { type: "error"; data: string }
  | { type: "done"; sessionId: string | null }
  | {
      type: "tool_approval_request";
      toolName: string;
      input: unknown;
      toolUseId: string;
      title?: string;
      decisionReason?: string;
    };
