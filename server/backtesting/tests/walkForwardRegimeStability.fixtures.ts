import type { WalkForwardRegimePerformance, WalkForwardRegimeBucket } from "../core/WalkForwardRegimeAnalytics";

export function makeFold(
  observations: number,
  sampleStatus: WalkForwardRegimeBucket["sampleStatus"],
  compoundedReturnPct: number,
  annualizedVolatilityPct: number | null,
  sharpeRatio: number | null,
): WalkForwardRegimePerformance {
  const bucket: WalkForwardRegimeBucket = {
    regime: "uptrend",
    observations,
    sampleStatus,
    compoundedReturnPct,
    annualizedVolatilityPct,
    sharpeRatio,
    sortinoRatio: sharpeRatio,
    maxEpisodeDrawdownPct: 0,
    episodeCount: observations > 0 ? 1 : 0,
  };
  return {
    status: "ready",
    observations,
    currentRegime: "uptrend",
    transitionCount: 0,
    transitionRatePct: 0,
    transitionIntervalReturnPct: null,
    buckets: [bucket],
    transitions: [],
  };
}
