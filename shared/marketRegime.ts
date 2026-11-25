import { z } from "zod";
import { MARKET_DATA_INTERVALS } from "./marketData";

export const marketRegimeRequestSchema = z.object({
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase()),
  interval: z.enum(MARKET_DATA_INTERVALS),
  startTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lookback: z.number().int().min(10).max(200).default(30),
  trendThresholdBps: z.number().int().min(10).max(2_000).default(100),
  rangeThresholdBps: z.number().int().min(5).max(1_000).default(50),
  highVolatilityThresholdBps: z.number().int().min(10).max(2_000).default(200),
}).strict().superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: "custom", message: "endTime must be greater than startTime", path: ["endTime"] });
  }
  if (value.endTime - value.startTime > 366 * 86_400_000) {
    ctx.addIssue({ code: "custom", message: "range cannot exceed 366 days", path: ["endTime"] });
  }
  if (value.rangeThresholdBps >= value.trendThresholdBps) {
    ctx.addIssue({ code: "custom", message: "range threshold must be below trend threshold", path: ["rangeThresholdBps"] });
  }
});
export type MarketRegimeRequest = z.infer<typeof marketRegimeRequestSchema>;
