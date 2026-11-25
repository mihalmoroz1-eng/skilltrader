import { z } from "zod";
import { MARKET_DATA_INTERVALS } from "./marketData";

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const symbol = z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase());

const baseRangeSchema = z.object({
  symbol,
  interval: z.enum(MARKET_DATA_INTERVALS),
  startTime: timestamp,
  endTime: timestamp,
}).strict();

function validateRange(value: { startTime: number; endTime: number }, ctx: z.RefinementCtx) {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: "custom", message: "endTime must be greater than startTime", path: ["endTime"] });
  }
  if (value.endTime - value.startTime > 366 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: "custom", message: "range cannot exceed 366 days", path: ["endTime"] });
  }
}

export const historicalDataRangeSchema = baseRangeSchema.extend({
  pageLimit: z.number().int().min(1).max(1000).default(1000),
}).superRefine(validateRange);

export const historicalDataQuerySchema = baseRangeSchema.extend({
  limit: z.number().int().min(1).max(100_000).default(10_000),
}).superRefine(validateRange);

export type HistoricalDataRangeInput = z.infer<typeof historicalDataRangeSchema>;
export type HistoricalDataQueryInput = z.infer<typeof historicalDataQuerySchema>;
