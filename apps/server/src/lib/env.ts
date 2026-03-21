import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  WORKSPACES_ROOT: z.string().min(1),
  STT_URL: z.string().default(""),
  TTS_URL: z.string().default(""),
  TTS_VOICE: z.string().default("af_heart"),
});

export const env = envSchema.parse(process.env);
