import { z } from "zod";

export const MARKET_DATA_INTERVALS = [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
] as const;

export const marketDataRequestSchema = z.object({
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform((value) => value.toUpperCase()),
  interval: z.enum(MARKET_DATA_INTERVALS),
  limit: z.number().int().min(1).max(1000).default(500),
}).strict();

export type MarketDataRequest = z.infer<typeof marketDataRequestSchema>;
