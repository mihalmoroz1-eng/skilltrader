import { z } from "zod";
import { MARKET_DATA_INTERVALS } from "./marketData";

export const researchAgentRequestSchema = z.object({
  symbol: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9]+$/).transform(value => value.toUpperCase()),
  interval: z.enum(MARKET_DATA_INTERVALS),
  limit: z.number().int().min(50).max(1000).default(500),
}).strict();

export const RESEARCH_EVIDENCE_CODES = [
  "spot_trend_bullish", "spot_trend_bearish", "spot_price_above_ema20", "spot_price_below_ema20",
  "macd_positive", "macd_negative", "rsi_extreme", "atr_low", "atr_normal", "atr_high",
  "spread_tight", "spread_normal", "spread_wide", "bid_depth_dominant", "ask_depth_dominant", "book_balanced",
  "funding_positive", "funding_negative", "funding_neutral", "funding_crowded_long", "funding_crowded_short",
  "basis_positive", "basis_negative", "basis_neutral", "open_interest_present",
] as const;

export const RESEARCH_RISK_FLAGS = [
  "thin_liquidity", "funding_crowding_long", "funding_crowding_short",
  "spot_futures_divergence", "elevated_volatility",
] as const;

export const researchAgentOutputSchema = z.object({
  assessment: z.enum(["constructive", "mixed", "cautionary", "insufficient"]),
  evidenceCodes: z.array(z.enum(RESEARCH_EVIDENCE_CODES)).min(1).max(20),
  riskFlags: z.array(z.enum(RESEARCH_RISK_FLAGS)).max(5),
}).strict();

export type ResearchAgentRequest = z.infer<typeof researchAgentRequestSchema>;
export type ResearchAgentOutput = z.infer<typeof researchAgentOutputSchema>;
