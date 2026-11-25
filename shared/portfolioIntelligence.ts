import { z } from "zod";
import { MARKET_DATA_INTERVALS } from "./marketData";

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const symbol = z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase());

export const portfolioIntelligenceRequestSchema = z.object({
  symbols: z.array(symbol).min(2).max(10),
  interval: z.enum(MARKET_DATA_INTERVALS),
  startTime: timestamp,
  endTime: timestamp,
}).strict().superRefine((value, ctx) => {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: "custom", path: ["endTime"], message: "endTime must be greater than startTime" });
  }
  if (value.endTime - value.startTime > 366 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: "custom", path: ["endTime"], message: "range cannot exceed 366 days" });
  }
  if (new Set(value.symbols).size !== value.symbols.length) {
    ctx.addIssue({ code: "custom", path: ["symbols"], message: "symbols must be unique" });
  }
});
export type PortfolioIntelligenceRequest = z.infer<typeof portfolioIntelligenceRequestSchema>;
