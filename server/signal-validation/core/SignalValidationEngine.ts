import { createHash } from "node:crypto";
import type { MarketIntelligenceResult } from "@shared/marketIntelligence";
import {
  signalValidationResultSchema,
  type SignalCandidate,
  type SignalValidationCheck,
  type SignalValidationResult,
} from "@shared/signalValidation";

const MAX_DATA_AGE_MS = 30_000;
const MIN_CLOSED_CANDLES = 50;
const MAX_CANDLE_AGE_INTERVALS = 2;

const FIXED_INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

const sha256 = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new Error("Signal validation payload is not serializable");
  return createHash("sha256").update(serialized).digest("hex");
};

function isSafeTimestamp(value: number, now: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= now;
}

function hasOnlyServerEvidence(
  codes: readonly string[],
  available: readonly string[],
): boolean {
  return codes.every((code) => available.includes(code));
}

function directionalCandidate(analysis: MarketIntelligenceResult, now: number): SignalCandidate | null {
  const marketCodes = analysis.serverEvidence.marketEvidenceCodes;
  const strategyCodes = analysis.strategy.evidenceCodes;
  const longEvidence = [
    "close_above_ema20",
    "ema20_above_ema50",
    "macd_histogram_positive",
    "trend_structure_up",
  ] as const;
  const shortEvidence = [
    "close_below_ema20",
    "ema20_below_ema50",
    "macd_histogram_negative",
    "trend_structure_down",
  ] as const;

  const longAligned = analysis.market.regime === "uptrend" &&
    analysis.market.momentum === "positive" &&
    analysis.strategy.context === "trend_context" &&
    longEvidence.every((code) => marketCodes.includes(code)) &&
    longEvidence.every((code) => analysis.market.evidenceCodes.includes(code)) &&
    (["ema20_above_ema50", "trend_structure_up"] as const).every((code) => strategyCodes.includes(code));

  const shortAligned = analysis.market.regime === "downtrend" &&
    analysis.market.momentum === "negative" &&
    analysis.strategy.context === "trend_context" &&
    shortEvidence.every((code) => marketCodes.includes(code)) &&
    shortEvidence.every((code) => analysis.market.evidenceCodes.includes(code)) &&
    (["ema20_below_ema50", "trend_structure_down"] as const).every((code) => strategyCodes.includes(code));

  if (!longAligned && !shortAligned) return null;
  const direction = longAligned ? "LONG" as const : "SHORT" as const;
  const thesisCodes = [...(longAligned ? longEvidence : shortEvidence)];
  const signalId = sha256({
    marketRunId: analysis.runId,
    direction,
    evidenceDigest: analysis.provenance.evidenceDigest,
  }).slice(0, 24);

  return {
    signalId,
    direction,
    symbol: analysis.provenance.symbol,
    interval: analysis.provenance.interval,
    thesisCodes,
    marketRunId: analysis.runId,
    createdAt: now,
  };
}

/**
 * Deterministic validation of an AI market-analysis result.
 *
 * "reviewable" means suitable for analyst review only. The account-level
 * position-risk engine is not connected, so executionEligible is always false.
 */
export function validateSignalCandidate(
  analysis: MarketIntelligenceResult,
  now = Date.now(),
): SignalValidationResult {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new Error("Signal validation clock must be a valid non-negative timestamp");
  }

  const provenance = analysis.provenance;
  const intervalMs = FIXED_INTERVAL_MS[provenance.interval];
  const dataAgeMs = now - provenance.fetchedAt;
  const sourceValid = provenance.source === "binance-spot" &&
    (provenance.freshness === "live" || provenance.freshness === "cached") &&
    /^[A-Z0-9]{2,20}$/.test(provenance.symbol) &&
    intervalMs !== undefined;
  const timestampsValid = isSafeTimestamp(provenance.fetchedAt, now) &&
    isSafeTimestamp(provenance.processedAt, now) &&
    provenance.processedAt >= provenance.fetchedAt &&
    Number.isSafeInteger(provenance.latestClosedCandleOpenTime) &&
    Number.isSafeInteger(provenance.latestClosedCandleCloseTime) &&
    provenance.latestClosedCandleOpenTime >= 0 &&
    provenance.latestClosedCandleCloseTime >= provenance.latestClosedCandleOpenTime &&
    provenance.latestClosedCandleCloseTime < provenance.processedAt &&
    now - provenance.latestClosedCandleCloseTime <= (intervalMs ?? 0) * MAX_CANDLE_AGE_INTERVALS;
  const marketDataValid = sourceValid &&
    timestampsValid &&
    provenance.qualityStatus === "ready" &&
    dataAgeMs >= 0 &&
    dataAgeMs <= MAX_DATA_AGE_MS &&
    Number.isSafeInteger(provenance.closedCandleCount) &&
    provenance.closedCandleCount >= MIN_CLOSED_CANDLES &&
    provenance.gapCount === 0;

  const deterministicBlockingCodes = [
    "atr_ratio_above_2_percent",
    "rsi_extreme",
    "price_extension_from_ema20",
    "indicator_disagreement",
  ] as const;
  const expectedAtrCode = analysis.technicalRiskGate.atrToClosePercent < 0.5
    ? "atr_ratio_below_0_5_percent"
    : analysis.technicalRiskGate.atrToClosePercent <= 2
      ? "atr_ratio_0_5_to_2_percent"
      : "atr_ratio_above_2_percent";
  const expectedBlockingCodes = analysis.serverEvidence.riskEvidenceCodes
    .filter((code) => deterministicBlockingCodes.includes(code as typeof deterministicBlockingCodes[number]));
  const technicalRiskMetadataValid =
    analysis.technicalRiskGate.evidenceCodes.length === analysis.serverEvidence.riskEvidenceCodes.length &&
    analysis.serverEvidence.riskEvidenceCodes.every((code) => analysis.technicalRiskGate.evidenceCodes.includes(code)) &&
    analysis.technicalRiskGate.blockingCodes.length === expectedBlockingCodes.length &&
    expectedBlockingCodes.every((code) => analysis.technicalRiskGate.blockingCodes.includes(code)) &&
    analysis.technicalRiskGate.status === (expectedBlockingCodes.length === 0 ? "clear" : "blocked") &&
    Number.isFinite(analysis.technicalRiskGate.atrToClosePercent) &&
    analysis.technicalRiskGate.atrToClosePercent >= 0 &&
    analysis.serverEvidence.riskEvidenceCodes.includes(expectedAtrCode) &&
    analysis.serverEvidence.riskEvidenceCodes.filter((code) =>
      code === "atr_ratio_below_0_5_percent" ||
      code === "atr_ratio_0_5_to_2_percent" ||
      code === "atr_ratio_above_2_percent",
    ).length === 1;

  const evidenceValid =
    hasOnlyServerEvidence(analysis.market.evidenceCodes, analysis.serverEvidence.marketEvidenceCodes) &&
    hasOnlyServerEvidence(analysis.strategy.evidenceCodes, analysis.serverEvidence.marketEvidenceCodes) &&
    analysis.risk.riskEvidenceCodes.length === analysis.serverEvidence.riskEvidenceCodes.length &&
    analysis.serverEvidence.riskEvidenceCodes.every((code) => analysis.risk.riskEvidenceCodes.includes(code)) &&
    technicalRiskMetadataValid;

  const consensusValid = analysis.status === "reviewable" &&
    analysis.critic.verdict === "consistent" &&
    analysis.critic.conflictCodes.length === 0;

  const candidate = evidenceValid && marketDataValid && consensusValid
    ? directionalCandidate(analysis, now)
    : null;

  const technicalRiskClear = evidenceValid &&
    analysis.technicalRiskGate.status === "clear" &&
    analysis.technicalRiskGate.blockingCodes.length === 0 &&
    analysis.risk.regime === "normal";

  const marketDataReason = !sourceValid
    ? "market_data_provenance_invalid" as const
    : !timestampsValid || dataAgeMs < 0 || dataAgeMs > MAX_DATA_AGE_MS
      ? "market_data_stale" as const
      : !marketDataValid
        ? "market_data_quality_failed" as const
        : "approved_source_and_fresh_data" as const;

  const checks: SignalValidationCheck[] = [
    {
      key: "market_data_integrity",
      state: marketDataValid ? "passed" : "failed",
      reasonCode: marketDataReason,
    },
    {
      key: "agent_consensus",
      state: consensusValid ? "passed" : "inconclusive",
      reasonCode: consensusValid ? "critic_consensus_confirmed" : "critic_consensus_missing",
    },
    {
      key: "directional_evidence",
      state: !evidenceValid ? "failed" : candidate ? "passed" : "failed",
      reasonCode: !evidenceValid
        ? "agent_evidence_not_server_verified"
        : candidate
          ? candidate.direction === "LONG" ? "uptrend_evidence_aligned" : "downtrend_evidence_aligned"
          : "directional_evidence_incomplete",
    },
    {
      key: "strategy_alignment",
      state: candidate ? "passed" : "failed",
      reasonCode: candidate ? "strategy_alignment_confirmed" : "strategy_context_not_trend_aligned",
    },
    {
      key: "technical_risk_gate",
      state: !evidenceValid ? "inconclusive" : technicalRiskClear ? "passed" : "failed",
      reasonCode: !evidenceValid
        ? "agent_evidence_not_server_verified"
        : technicalRiskClear
          ? "technical_risk_clear"
          : analysis.risk.regime !== "normal"
            ? "technical_risk_agent_disagreement"
            : "technical_risk_blocked",
    },
    {
      key: "account_risk_engine",
      state: "not_connected",
      reasonCode: "account_risk_engine_not_integrated",
    },
  ];

  const rejectedReasonCodes = checks
    .filter((check) => check.state === "failed" || check.state === "inconclusive")
    .map((check) => check.reasonCode);
  const warnings = [
    "Reviewable means analyst review only; it is not a trade recommendation or an execution approval.",
    "The account-level deterministic Risk Engine and position-size validation are not integrated.",
    "No entry, stop, target, leverage, position size or order is produced by this validation stage.",
  ];

  let status: SignalValidationResult["status"];
  if (!marketDataValid || !evidenceValid || !technicalRiskClear) {
    status = "rejected";
  } else if (!consensusValid) {
    status = "inconclusive";
  } else if (!candidate) {
    status = "no_candidate";
    rejectedReasonCodes.push("no_supported_directional_candidate");
  } else {
    status = "reviewable";
  }

  const validationPayload = {
    status,
    candidate,
    checks,
    rejectedReasonCodes,
    warnings,
    marketRunId: analysis.runId,
    marketEvidenceDigest: provenance.evidenceDigest,
    validatedAt: now,
  };
  const result = {
    status,
    candidate,
    checks,
    rejectedReasonCodes: [...new Set(rejectedReasonCodes)],
    warnings,
    provenance: {
      marketRunId: analysis.runId,
      marketEvidenceDigest: provenance.evidenceDigest,
      validationDigest: sha256(validationPayload),
      validatedAt: now,
    },
    executionEligible: false as const,
    requiresSeparateAccountRiskEngine: true as const,
    manualReviewOnly: true as const,
  };

  return signalValidationResultSchema.parse(result);
}
