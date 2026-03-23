import { query, type SDKMessage, type SDKUserMessage, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";
import type { ToolApprovalResult } from "./types.js";

export interface ImageAttachment {
  data: string; // base64
  mediaType: string; // image/png, image/jpeg, etc.
}

export interface RunQueryOptions {
  prompt: string;
  resumeId?: string;
  cwd: string;
  model?: string;
  images?: ImageAttachment[];
  permissionMode?: string;
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
      let prompt: string | AsyncIterable<SDKUserMessage> = options.prompt;

      if (options.images && options.images.length > 0) {
        const content: any[] = options.images.map((img) => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data },
        }));
        content.push({ type: "text", text: options.prompt });

        const sessionId = options.resumeId || randomUUID();
        async function* imagePrompt(): AsyncGenerator<SDKUserMessage> {
          yield {
            type: "user",
            message: { role: "user", content },
            parent_tool_use_id: null,
            session_id: sessionId,
          };
        }
        prompt = imagePrompt();
      }

      const q = query({
        prompt,
        options: {
          abortController,
          cwd: options.cwd,
          includePartialMessages: true,
          ...(options.resumeId ? { resume: options.resumeId } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.permissionMode ? { permissionMode: options.permissionMode as PermissionMode } : {}),
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
