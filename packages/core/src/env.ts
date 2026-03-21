import { z } from "zod";

export const coreEnvSchema = z.object({
  WORKSPACES_ROOT: z.string().min(1),
});

export const coreEnv = coreEnvSchema.parse(process.env);
