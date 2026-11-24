import { z } from "zod";
import { MARKET_DATA_INTERVALS } from "./marketData";

export const backtestRequestSchema = z.object({
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase()),
  interval: z.enum(MARKET_DATA_INTERVALS),
  startTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startingCapital: z.number().finite().min(1).max(1_000_000_000),
  riskBps: z.number().int().min(1).max(1_000).default(100),
  stopLossBps: z.number().int().min(10).max(5_000).default(200),
  takeProfitBps: z.number().int().min(10).max(10_000).default(400),
  feeBps: z.number().int().min(0).max(100).default(10),
  slippageBps: z.number().int().min(0).max(100).default(5),
  fastEmaPeriod: z.number().int().min(2).max(100).default(20),
  slowEmaPeriod: z.number().int().min(3).max(300).default(50),
  allowShort: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: "custom", message: "endTime must be greater than startTime", path: ["endTime"] });
  }
  if (value.endTime - value.startTime > 366 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: "custom", message: "range cannot exceed 366 days", path: ["endTime"] });
  }
  if (value.fastEmaPeriod >= value.slowEmaPeriod) {
    ctx.addIssue({ code: "custom", message: "fast EMA period must be less than slow EMA period", path: ["fastEmaPeriod"] });
  }
  if (value.riskBps >= value.stopLossBps) {
    ctx.addIssue({ code: "custom", message: "risk budget must be below stop-loss distance for 1x notional cap", path: ["riskBps"] });
  }
});

export type BacktestRequest = z.infer<typeof backtestRequestSchema>;
