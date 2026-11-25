import type { CanonicalMarketRegime } from "../../market-regime/core/MarketRegimeClassifier";
import type { WalkForwardRegimePerformance } from "./WalkForwardRegimeAnalytics";

export type RegimeStabilityBucket = {
  regime: CanonicalMarketRegime;
  foldsObserved: number;
  totalFolds: number;
  foldCoveragePct: number;
  adequateSampleFolds: number;
  limitedSampleFolds: number;
  insufficientSampleFolds: number;
  positiveReturnFolds: number;
  positiveReturnSharePct: number | null;
  meanConditionalReturnPct: number | null;
  medianConditionalReturnPct: number | null;
  worstConditionalReturnPct: number | null;
  bestConditionalReturnPct: number | null;
  conditionalReturnStdDevPct: number | null;
  meanAnnualizedVolatilityPct: number | null;
  medianAnnualizedVolatilityPct: number | null;
  worstSharpeRatio: number | null;
  medianSharpeRatio: number | null;
  worstSortinoRatio: number | null;
  medianSortinoRatio: number | null;
};

export type WalkForwardRegimeStability = {
  status: "ready" | "insufficient_folds";
  totalFolds: number;
  buckets: RegimeStabilityBucket[];
};

const REGIMES: CanonicalMarketRegime[] = [
  "uptrend", "downtrend", "ranging", "high_volatility", "transition",
];

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function stdDev(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function finiteValues(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function aggregate(values: Array<number | null>, mode: "mean" | "median" | "worst" | "best" | "stddev"): number | null {
  const valid = finiteValues(values);
  if (valid.length < 2) return null;
  if (mode === "mean") return mean(valid);
  if (mode === "median") return median(valid);
  if (mode === "worst") return Math.min(...valid);
  if (mode === "best") return Math.max(...valid);
  return stdDev(valid);
}

/**
 * Summarizes fold-local regime metrics without pooling interval returns or equity curves.
 * Conditional-return summaries are descriptive across folds; each fold remains an
 * independent observation and small per-regime samples are explicitly counted.
 */
export function aggregateWalkForwardRegimeStability(
  folds: WalkForwardRegimePerformance[],
): WalkForwardRegimeStability {
  const totalFolds = folds.length;
  const buckets = REGIMES.map(regime => {
    const observed = folds.flatMap(fold => {
      if (fold.status !== "ready") return [];
      const bucket = fold.buckets.find(item => item.regime === regime);
      return bucket && bucket.observations > 0 ? [{ bucket }] : [];
    });
    const returns = observed.map(item => item.bucket.compoundedReturnPct);
    const validReturns = finiteValues(returns);
    const positiveReturnFolds = validReturns.filter(value => value > 0).length;
    const volatilities = observed.map(item => item.bucket.annualizedVolatilityPct);
    const sharpes = observed.map(item => item.bucket.sharpeRatio);
    const sortinos = observed.map(item => item.bucket.sortinoRatio);
    const observedCount = observed.length;

    const result: RegimeStabilityBucket = {
      regime,
      foldsObserved: observedCount,
      totalFolds,
      foldCoveragePct: totalFolds > 0 ? observedCount / totalFolds * 100 : 0,
      adequateSampleFolds: observed.filter(item => item.bucket.sampleStatus === "adequate_sample").length,
      limitedSampleFolds: observed.filter(item => item.bucket.sampleStatus === "limited_sample").length,
      insufficientSampleFolds: observed.filter(item => item.bucket.sampleStatus === "insufficient_sample").length,
      positiveReturnFolds,
      positiveReturnSharePct: validReturns.length >= 2 ? positiveReturnFolds / validReturns.length * 100 : null,
      meanConditionalReturnPct: aggregate(returns, "mean"),
      medianConditionalReturnPct: aggregate(returns, "median"),
      worstConditionalReturnPct: aggregate(returns, "worst"),
      bestConditionalReturnPct: aggregate(returns, "best"),
      conditionalReturnStdDevPct: aggregate(returns, "stddev"),
      meanAnnualizedVolatilityPct: aggregate(volatilities, "mean"),
      medianAnnualizedVolatilityPct: aggregate(volatilities, "median"),
      worstSharpeRatio: aggregate(sharpes, "worst"),
      medianSharpeRatio: aggregate(sharpes, "median"),
      worstSortinoRatio: aggregate(sortinos, "worst"),
      medianSortinoRatio: aggregate(sortinos, "median"),
    };
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error(`Non-finite regime stability metric: ${key}`);
      }
    }
    return result;
  });

  return { status: totalFolds >= 2 ? "ready" : "insufficient_folds", totalFolds, buckets };
}
