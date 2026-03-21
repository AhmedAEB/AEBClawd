import { Hono } from "hono";
import { query, type ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { getWorkspacesRoot } from "../lib/paths.js";
import { logger } from "../lib/logger.js";

const models = new Hono();

let cachedModels: ModelInfo[] | null = null;

async function fetchModels(): Promise<ModelInfo[]> {
  if (cachedModels) return cachedModels;

  logger.info("[models] Fetching available models from SDK");

  let resolve: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });

  async function* emptyInput() {
    await gate;
  }

  const q = query({
    prompt: emptyInput(),
    options: {
      cwd: getWorkspacesRoot(),
      systemPrompt: { type: "preset", preset: "claude_code" },
    },
  });

  try {
    const result = await q.supportedModels();
    cachedModels = result;
    logger.info(`[models] Found ${result.length} models`);
    return result;
  } finally {
    resolve!();
    q.close();
  }
}

models.get("/", async (c) => {
  try {
    const result = await fetchModels();
    return c.json(result);
  } catch (err: any) {
    logger.error(`[models] Error: ${err.message}`);
    return c.json({ error: "Failed to fetch models" }, 500);
  }
});

export default models;
