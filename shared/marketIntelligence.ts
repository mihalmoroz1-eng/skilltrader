import { z } from "zod";
import { marketDataRequestSchema } from "./marketData";

export const MARKET_INTELLIGENCE_PROMPT_VERSION = "2026-11-24.1";

export const MARKET_EVIDENCE_CODES = [
  "close_above_ema20",
  "close_below_ema20",
  "ema20_above_ema50",
  "ema20_below_ema50",
  "rsi_overbought",
  "rsi_oversold",
  "rsi_neutral",
  "macd_histogram_positive",
  "macd_histogram_negative",
  "close_above_vwap",
  "close_below_vwap",
  "trend_structure_up",
  "trend_structure_down",
  "trend_structure_mixed",
] as const;

export const RISK_EVIDENCE_CODES = [
  "atr_ratio_below_0_5_percent",
  "atr_ratio_0_5_to_2_percent",
  "atr_ratio_above_2_percent",
  "rsi_extreme",
  "price_extension_from_ema20",
  "indicator_disagreement",
] as const;

export const MARKET_REGIMES = ["uptrend", "downtrend", "range", "mixed"] as const;
export const MARKET_MOMENTUM_STATES = ["positive", "negative", "mixed", "neutral"] as const;
export const STRATEGY_CONTEXTS = ["trend_context", "mean_reversion_context", "mixed_context", "no_clear_context"] as const;
export const RISK_REGIMES = ["normal", "elevated", "uncertain"] as const;
export const CRITIC_VERDICTS = ["consistent", "contradictory", "insufficient_evidence"] as const;
export const CRITIC_CONFLICT_CODES = [
  "market_strategy_disagreement",
  "market_risk_disagreement",
  "unsupported_evidence",
  "unsupported_certainty",
  "data_quality_disagreement",
] as const;

export const marketIntelligenceRequestSchema = marketDataRequestSchema.strict();

export const marketAgentOutputSchema = z.object({
  regime: z.enum(MARKET_REGIMES),
  momentum: z.enum(MARKET_MOMENTUM_STATES),
  evidenceCodes: z.array(z.enum(MARKET_EVIDENCE_CODES)).max(8),
}).strict();

export const strategyAgentOutputSchema = z.object({
  context: z.enum(STRATEGY_CONTEXTS),
  evidenceCodes: z.array(z.enum(MARKET_EVIDENCE_CODES)).max(8),
}).strict();

export const riskAgentOutputSchema = z.object({
  regime: z.enum(RISK_REGIMES),
  riskEvidenceCodes: z.array(z.enum(RISK_EVIDENCE_CODES)).max(6),
}).strict();

export const criticAgentOutputSchema = z.object({
  verdict: z.enum(CRITIC_VERDICTS),
  conflictCodes: z.array(z.enum(CRITIC_CONFLICT_CODES)).max(CRITIC_CONFLICT_CODES.length),
}).strict();

export type MarketAgentOutput = z.infer<typeof marketAgentOutputSchema>;
export type StrategyAgentOutput = z.infer<typeof strategyAgentOutputSchema>;
export type RiskAgentOutput = z.infer<typeof riskAgentOutputSchema>;
export type CriticAgentOutput = z.infer<typeof criticAgentOutputSchema>;

export type MarketIntelligenceResult = {
  runId: string;
  serverEvidence: {
    marketEvidenceCodes: MarketAgentOutput["evidenceCodes"];
    riskEvidenceCodes: RiskAgentOutput["riskEvidenceCodes"];
    latestClosedCandleOpenTime: number;
    latestClosedCandleCloseTime: number;
  };
  technicalRiskGate: {
    status: "clear" | "blocked";
    atrToClosePercent: number;
    evidenceCodes: RiskAgentOutput["riskEvidenceCodes"];
    blockingCodes: RiskAgentOutput["riskEvidenceCodes"];
  };
  status: "reviewable" | "inconclusive";
  market: MarketAgentOutput;
  strategy: StrategyAgentOutput;
  risk: RiskAgentOutput;
  critic: CriticAgentOutput;
  provenance: {
    source: string;
    freshness: "live" | "cached";
    qualityStatus: "ready" | "degraded" | "insufficient";
    symbol: string;
    interval: string;
    fetchedAt: number;
    processedAt: number;
    dataAgeMs: number;
    latestClosedCandleOpenTime: number;
    latestClosedCandleCloseTime: number;
    closedCandleCount: number;
    gapCount: number;
    promptVersion: string;
    modelByAgent: {
      market: string;
      strategy: string;
      risk: string;
      critic: string;
    };
    evidenceDigest: string;
  };
  warnings: string[];
  noTradeSignalGenerated: true;
  noOrderExecuted: true;
};
