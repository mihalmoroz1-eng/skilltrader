import { describe, expect, it } from "vitest";
import type { MarketIntelligenceResult } from "@shared/marketIntelligence";
import { validateSignalCandidate } from "../core/SignalValidationEngine";

const NOW = Date.UTC(2026, 10, 24, 20, 0, 0);
const BASE_MARKET_CODES = [
  "close_above_ema20",
  "ema20_above_ema50",
  "macd_histogram_positive",
  "trend_structure_up",
  "close_above_vwap",
] as const;

function createAnalysis(overrides?: Partial<MarketIntelligenceResult>): MarketIntelligenceResult {
  const openTime = NOW - 15 * 60_000;
  const closeTime = openTime + 15 * 60_000 - 1;
  const base: MarketIntelligenceResult = {
    runId: "market-run-123",
    status: "reviewable",
    serverEvidence: {
      marketEvidenceCodes: [...BASE_MARKET_CODES],
      riskEvidenceCodes: ["atr_ratio_0_5_to_2_percent"],
      latestClosedCandleOpenTime: openTime,
      latestClosedCandleCloseTime: closeTime,
    },
    technicalRiskGate: {
      status: "clear",
      atrToClosePercent: 0.8,
      evidenceCodes: ["atr_ratio_0_5_to_2_percent"],
      blockingCodes: [],
    },
    market: {
      regime: "uptrend",
      momentum: "positive",
      evidenceCodes: [...BASE_MARKET_CODES],
    },
    strategy: {
      context: "trend_context",
      evidenceCodes: ["ema20_above_ema50", "trend_structure_up"],
    },
    risk: {
      regime: "normal",
      riskEvidenceCodes: ["atr_ratio_0_5_to_2_percent"],
    },
    critic: {
      verdict: "consistent",
      conflictCodes: [],
    },
    provenance: {
      source: "binance-spot",
      freshness: "live",
      qualityStatus: "ready",
      symbol: "BTCUSDT",
      interval: "15m",
      fetchedAt: NOW - 1_000,
      processedAt: NOW - 900,
      dataAgeMs: 1_000,
      latestClosedCandleOpenTime: openTime,
      latestClosedCandleCloseTime: closeTime,
      closedCandleCount: 96,
      gapCount: 0,
      promptVersion: "2026-11-24.1",
      modelByAgent: {
        market: "fixture",
        strategy: "fixture",
        risk: "fixture",
        critic: "fixture",
      },
      evidenceDigest: "a".repeat(64),
    },
    warnings: [],
    noTradeSignalGenerated: true,
    noOrderExecuted: true,
  };

  return {
    ...base,
    ...overrides,
    provenance: { ...base.provenance, ...overrides?.provenance },
    market: { ...base.market, ...overrides?.market },
    strategy: { ...base.strategy, ...overrides?.strategy },
    risk: { ...base.risk, ...overrides?.risk },
    critic: { ...base.critic, ...overrides?.critic },
    serverEvidence: { ...base.serverEvidence, ...overrides?.serverEvidence },
    technicalRiskGate: { ...base.technicalRiskGate, ...overrides?.technicalRiskGate },
  };
}

describe("deterministic signal validation engine", () => {
  it("creates a review-only LONG candidate when data, trend evidence, strategy and technical risk align", () => {
    const result = validateSignalCandidate(createAnalysis(), NOW);

    expect(result.status).toBe("reviewable");
    expect(result.candidate?.direction).toBe("LONG");
    expect(result.candidate?.thesisCodes).toContain("trend_structure_up");
    expect(result.checks.find((check) => check.key === "technical_risk_gate")?.state).toBe("passed");
    expect(result.checks.find((check) => check.key === "account_risk_engine")?.state).toBe("not_connected");
    expect(result.executionEligible).toBe(false);
    expect(result.requiresSeparateAccountRiskEngine).toBe(true);
    expect(result.manualReviewOnly).toBe(true);
    expect(result.provenance.validationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates a SHORT candidate only with matching downtrend evidence", () => {
    const downCodes = [
      "close_below_ema20",
      "ema20_below_ema50",
      "macd_histogram_negative",
      "trend_structure_down",
      "close_below_vwap",
    ] as const;
    const analysis = createAnalysis({
      serverEvidence: { ...createAnalysis().serverEvidence, marketEvidenceCodes: [...downCodes] },
      market: { regime: "downtrend", momentum: "negative", evidenceCodes: [...downCodes] },
      strategy: { context: "trend_context", evidenceCodes: ["ema20_below_ema50", "trend_structure_down"] },
    });

    const result = validateSignalCandidate(analysis, NOW);

    expect(result.status).toBe("reviewable");
    expect(result.candidate?.direction).toBe("SHORT");
    expect(result.candidate?.thesisCodes).toContain("trend_structure_down");
  });

  it("rejects a stale market snapshot", () => {
    const analysis = createAnalysis({
      provenance: {
        ...createAnalysis().provenance,
        fetchedAt: NOW - 31_000,
        dataAgeMs: 31_000,
      },
    });

    const result = validateSignalCandidate(analysis, NOW);
    expect(result.status).toBe("rejected");
    expect(result.candidate).toBeNull();
    expect(result.checks.find((check) => check.key === "market_data_integrity")?.reasonCode).toBe("market_data_stale");
  });

  it("rejects a technical risk gate breach even when the Risk Agent labels the regime normal", () => {
    const analysis = createAnalysis({
      serverEvidence: {
        ...createAnalysis().serverEvidence,
        riskEvidenceCodes: ["atr_ratio_above_2_percent"],
      },
      technicalRiskGate: {
        status: "blocked",
        atrToClosePercent: 2.7,
        evidenceCodes: ["atr_ratio_above_2_percent"],
        blockingCodes: ["atr_ratio_above_2_percent"],
      },
      risk: {
        regime: "normal",
        riskEvidenceCodes: ["atr_ratio_above_2_percent"],
      },
    });

    const result = validateSignalCandidate(analysis, NOW);
    expect(result.status).toBe("rejected");
    expect(result.candidate).toBeNull();
    expect(result.checks.find((check) => check.key === "technical_risk_gate")?.reasonCode).toBe("technical_risk_blocked");
  });

  it("rejects agent evidence that is not present in the server evidence snapshot", () => {
    const analysis = createAnalysis({
      market: {
        regime: "uptrend",
        momentum: "positive",
        evidenceCodes: [...BASE_MARKET_CODES, "rsi_overbought"],
      },
    });

    const result = validateSignalCandidate(analysis, NOW);
    expect(result.status).toBe("rejected");
    expect(result.candidate).toBeNull();
    expect(result.checks.find((check) => check.key === "directional_evidence")?.reasonCode).toBe("agent_evidence_not_server_verified");
  });

  it("does not create a candidate without critic consensus", () => {
    const analysis = createAnalysis({
      status: "inconclusive",
      critic: {
        verdict: "contradictory",
        conflictCodes: ["market_strategy_disagreement"],
      },
    });

    const result = validateSignalCandidate(analysis, NOW);
    expect(result.status).toBe("inconclusive");
    expect(result.candidate).toBeNull();
    expect(result.checks.find((check) => check.key === "agent_consensus")?.state).toBe("inconclusive");
  });

  it("returns no_candidate for a range market rather than forcing a direction", () => {
    const analysis = createAnalysis({
      market: {
        regime: "range",
        momentum: "neutral",
        evidenceCodes: ["rsi_neutral", "trend_structure_mixed"],
      },
      strategy: {
        context: "mixed_context",
        evidenceCodes: ["rsi_neutral", "trend_structure_mixed"],
      },
      serverEvidence: {
        ...createAnalysis().serverEvidence,
        marketEvidenceCodes: ["rsi_neutral", "trend_structure_mixed"],
      },
    });

    const result = validateSignalCandidate(analysis, NOW);
    expect(result.status).toBe("no_candidate");
    expect(result.candidate).toBeNull();
    expect(result.rejectedReasonCodes).toContain("no_supported_directional_candidate");
  });

  it("accepts a fresh cached market-data response but keeps execution disabled", () => {
    const analysis = createAnalysis({
      provenance: {
        ...createAnalysis().provenance,
        freshness: "cached",
        fetchedAt: NOW - 2_000,
        dataAgeMs: 2_000,
      },
    });

    const result = validateSignalCandidate(analysis, NOW);
    expect(result.status).toBe("reviewable");
    expect(result.executionEligible).toBe(false);
  });

  it("requires an exact server-derived risk evidence match", () => {
    const analysis = createAnalysis({
      risk: {
        regime: "normal",
        riskEvidenceCodes: [],
      },
    });
    const result = validateSignalCandidate(analysis, NOW);

    expect(result.status).toBe("rejected");
    expect(result.checks.find((check) => check.key === "technical_risk_gate")?.state).toBe("inconclusive");
  });

  it("rejects invalid validation timestamps", () => {
    expect(() => validateSignalCandidate(createAnalysis(), Number.NaN)).toThrow();
  });
});
