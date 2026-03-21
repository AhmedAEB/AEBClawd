import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  WORKSPACES_ROOT: z.string().min(1),
});

export const env = envSchema.parse(process.env);
