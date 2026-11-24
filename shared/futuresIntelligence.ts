import { z } from "zod";

export const futuresIntelligenceRequestSchema = z.object({
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase()),
  depthLimit: z.number().int().min(5).max(1000).default(100),
}).strict();

export type FuturesIntelligenceRequest = z.infer<typeof futuresIntelligenceRequestSchema>;
