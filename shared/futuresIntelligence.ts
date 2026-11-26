import { z } from "zod";

export const futuresIntelligenceRequestSchema = z.object({
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase()),
  depthLimit: z.number().int().min(5).max(1000).default(100),
}).strict();

export type FuturesIntelligenceRequest = z.infer<typeof futuresIntelligenceRequestSchema>;


export const futuresExecutionSimulationRequestSchema = z.object({
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase()),
  requestedNotionalUsd: z.number().finite().min(1).max(10_000_000),
  depthLimit: z.number().int().min(5).max(1000).default(100),
}).strict();

export type FuturesExecutionSimulationRequest = z.infer<typeof futuresExecutionSimulationRequestSchema>;


const historicalOrderBookSymbol = z.string().trim().min(2).max(20)
  .regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase());

export const historicalOrderBookCaptureRequestSchema = z.object({
  symbol: historicalOrderBookSymbol,
  depthLimit: z.number().int().min(5).max(1000).default(100),
}).strict();

export const historicalOrderBookHistoryRequestSchema = z.object({
  symbol: historicalOrderBookSymbol,
  startTime: z.number().int().nonnegative().safe(),
  endTime: z.number().int().positive().safe(),
  limit: z.number().int().min(1).max(5000).default(500),
}).strict().refine(value => value.endTime > value.startTime &&
  value.endTime - value.startTime <= 366 * 24 * 60 * 60 * 1000, {
  message: "Historical order-book range must be positive and no longer than 366 days",
});

export const historicalOrderBookMatchRequestSchema = z.object({
  symbol: historicalOrderBookSymbol,
  decisionTime: z.number().int().nonnegative().safe(),
  maxAgeMs: z.number().int().min(1).max(300_000).default(30_000),
}).strict();

export const historicalLiquidityCoverageRequestSchema = z.object({
  symbol: historicalOrderBookSymbol,
  interval: z.enum(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]),
  startTime: z.number().int().nonnegative().safe(),
  endTime: z.number().int().positive().safe(),
  maxAgeMs: z.number().int().min(1).max(300_000).default(30_000),
}).strict().refine(value => value.endTime > value.startTime &&
  value.endTime - value.startTime <= 366 * 24 * 60 * 60 * 1000, {
  message: "Historical liquidity coverage range must be positive and no longer than 366 days",
});

export type HistoricalOrderBookCaptureRequest = z.infer<typeof historicalOrderBookCaptureRequestSchema>;
export type HistoricalOrderBookHistoryRequest = z.infer<typeof historicalOrderBookHistoryRequestSchema>;
export type HistoricalOrderBookMatchRequest = z.infer<typeof historicalOrderBookMatchRequestSchema>;

export type HistoricalLiquidityCoverageRequest = z.infer<typeof historicalLiquidityCoverageRequestSchema>;
