import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";
import type { ToolApprovalResult } from "./types.js";

export interface RunQueryOptions {
  prompt: string;
  resumeId?: string;
  cwd: string;
}

export interface RunQueryCallbacks {
  onMessage: (message: SDKMessage) => void;
  onToolApproval: (
    toolName: string,
    input: unknown,
    opts: { toolUseID: string; title?: string; decisionReason?: string },
  ) => Promise<ToolApprovalResult>;
  onDone: () => void;
  onError: (error: Error) => void;
}

export async function runQuery(
  options: RunQueryOptions,
  callbacks: RunQueryCallbacks,
): Promise<AbortController> {
  const abortController = new AbortController();

  logger.info(
    `[query] prompt="${options.prompt.slice(0, 80)}" resume=${options.resumeId ?? "none"} cwd=${options.cwd}`,
  );

  (async () => {
    try {
      const q = query({
        prompt: options.prompt,
        options: {
          abortController,
          cwd: options.cwd,
          includePartialMessages: true,
          ...(options.resumeId ? { resume: options.resumeId } : {}),
          systemPrompt: { type: "preset", preset: "claude_code" },
          canUseTool: async (toolName, input, opts) => {
            if (toolName === "AskUserQuestion") {
              return { behavior: "allow", updatedInput: input };
            }
            return callbacks.onToolApproval(toolName, input, opts);
          },
        },
      });

      for await (const message of q) {
        if (abortController.signal.aborted) break;
        callbacks.onMessage(message);
      }
    } catch (err: any) {
      if (err.name === "AbortError" || abortController.signal.aborted) {
        logger.info("[query] Aborted");
      } else {
        logger.error(`[query] Error: ${err.message}`);
        callbacks.onError(err);
      }
    } finally {
      callbacks.onDone();
    }
  })();

  return abortController;
}
