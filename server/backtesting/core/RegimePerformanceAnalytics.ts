import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import {
  classifyMarketRegimeWindow,
  type CanonicalMarketRegime,
} from "../../market-regime/core/MarketRegimeClassifier";

export type RegimePerformanceConfig = {
  interval: MarketInterval;
  lookback: number;
  trendThresholdBps: number;
  rangeThresholdBps: number;
  highVolatilityThresholdBps: number;
};

export type RegimePerformanceTradeCount = {
  id: string;
  tradeCount: number;
};

export type RegimePerformanceBucket = {
  regime: CanonicalMarketRegime;
  observations: number;
  tradeCount: number;
  sampleStatus: "insufficient_sample" | "limited_sample" | "adequate_sample";
  totalReturnPct: number | null;
  annualizedVolatilityPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxEpisodeDrawdownPct: number | null;
  episodeCount: number;
};

export type RegimeTransition = {
  from: CanonicalMarketRegime;
  to: CanonicalMarketRegime;
  count: number;
};

export type RegimePerformanceAnalytics = {
  status: "ready" | "insufficient_data";
  observations: number;
  classifiedCandles: number;
  currentRegime: CanonicalMarketRegime | null;
  transitionCount: number;
  transitionRatePct: number | null;
  transitionIntervalReturnPct: number | null;
  transitionIntervalCount: number;
  buckets: RegimePerformanceBucket[];
  transitions: RegimeTransition[];
  methodology: string[];
};

const REGIMES: CanonicalMarketRegime[] = [
  "uptrend", "downtrend", "ranging", "high_volatility", "transition",
];

const FIXED_INTERVAL_MS: Partial<Record<MarketInterval, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
  "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000,
  "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

function annualizationPeriods(interval: MarketInterval): number {
  return interval === "1M" ? 12 : 365.2425 * 86_400_000 / (FIXED_INTERVAL_MS[interval] ?? 0);
}

type ReturnObservation = { value: number; regime: CanonicalMarketRegime };

function emptyBucket(
  regime: CanonicalMarketRegime,
  tradeCount: number,
): RegimePerformanceBucket {
  return {
    regime, observations: 0, tradeCount, sampleStatus: "insufficient_sample",
    totalReturnPct: null, annualizedVolatilityPct: null, sharpeRatio: null,
    sortinoRatio: null, maxEpisodeDrawdownPct: null, episodeCount: 0,
  };
}

function summarizeBucket(
  regime: CanonicalMarketRegime,
  observations: ReturnObservation[],
  tradeCount: number,
  interval: MarketInterval,
  totalClassifiedCandles: number,
): RegimePerformanceBucket {
  const values = observations.map(item => item.value);
  const count = values.length;
  const sampleStatus = count < 5 ? "insufficient_sample"
    : count < 30 ? "limited_sample" : "adequate_sample";
  const grossFactor = values.reduce((factor, value) => factor * (1 + value), 1);
  if (!Number.isFinite(grossFactor)) throw new Error("Non-finite compounded regime return; analytics withheld");
  const totalReturn = grossFactor - 1;
  const regimeShare = totalClassifiedCandles > 0 ? count / totalClassifiedCandles : 0;
  const periods = annualizationPeriods(interval) * regimeShare;

  let annualizedVolatilityPct: number | null = null;
  let sharpeRatio: number | null = null;
  let sortinoRatio: number | null = null;
  if (count >= 30 && Number.isFinite(periods) && periods > 0) {
    const mean = values.reduce((sum, value) => sum + value, 0) / count;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
    const volatility = Math.sqrt(variance);
    const downside = Math.sqrt(values.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / count);
    if (Number.isFinite(volatility)) {
      const annualized = volatility * Math.sqrt(periods) * 100;
      if (Number.isFinite(annualized)) annualizedVolatilityPct = annualized;
      if (volatility > 0) {
        const sharpe = mean / volatility * Math.sqrt(periods);
        if (Number.isFinite(sharpe)) sharpeRatio = sharpe;
      }
    }
    if (Number.isFinite(downside) && downside > 0) {
      const sortino = mean / downside * Math.sqrt(periods);
      if (Number.isFinite(sortino)) sortinoRatio = sortino;
    }
  }

  // Drawdown is measured independently inside each uninterrupted episode of this regime.
  // Non-adjacent episodes are never concatenated into a synthetic chronological equity curve.
  let episodeCount = 0;
  let episodeEquity = 1;
  let episodePeak = 1;
  let maxEpisodeDrawdownPct = 0;
  let previousIndex = -2;
  for (const observation of observations) {
    const index = (observation as ReturnObservation & { index?: number }).index;
    if (index === undefined || index !== previousIndex + 1) {
      if (episodeCount > 0) {
        episodeEquity = 1;
        episodePeak = 1;
      }
      episodeCount += 1;
    }
    episodeEquity *= 1 + observation.value;
    if (!Number.isFinite(episodeEquity)) throw new Error("Non-finite regime episode equity; analytics withheld");
    episodePeak = Math.max(episodePeak, episodeEquity);
    if (episodePeak > 0) {
      maxEpisodeDrawdownPct = Math.max(
        maxEpisodeDrawdownPct,
        (episodePeak - episodeEquity) / episodePeak * 100,
      );
    }
    previousIndex = index ?? previousIndex + 1;
  }

  return {
    regime,
    observations: count,
    tradeCount,
    sampleStatus,
    totalReturnPct: count > 0 && Number.isFinite(totalReturn * 100) ? totalReturn * 100 : null,
    annualizedVolatilityPct,
    sharpeRatio: Number.isFinite(sharpeRatio) ? sharpeRatio : null,
    sortinoRatio: Number.isFinite(sortinoRatio) ? sortinoRatio : null,
    maxEpisodeDrawdownPct: count ? maxEpisodeDrawdownPct : null,
    episodeCount,
  };
}

export function analyzeRegimePerformance(
  candles: MarketCandle[],
  equityCurve: Array<{ time: number; equity: number }>,
  tradeCounts: RegimePerformanceTradeCount[],
  config: RegimePerformanceConfig,
): RegimePerformanceAnalytics {
  const tradeCountByRegime = new Map(tradeCounts.map(item => [item.id, item.tradeCount]));
  const observationsByRegime = new Map<CanonicalMarketRegime, Array<ReturnObservation & { index: number }>>(
    REGIMES.map(regime => [regime, []]),
  );
  if (equityCurve.length < 2 || candles.length === 0) {
    return {
      status: "insufficient_data", observations: 0, classifiedCandles: 0,
      currentRegime: null, transitionCount: 0, transitionRatePct: null,
      transitionIntervalReturnPct: null, transitionIntervalCount: 0,
      buckets: REGIMES.map(regime => emptyBucket(regime, tradeCountByRegime.get(regime) ?? 0)),
      transitions: [], methodology: ["At least one marked-to-market candle interval is required."],
    };
  }

  const evaluationStartTime = equityCurve[0].time;
  const evaluationStartIndex = candles.findIndex(candle => candle.openTime === evaluationStartTime);
  if (evaluationStartIndex < 0) {
    throw new Error("Equity curve start does not align with the validated candle series");
  }

  let classifiedCandles = 0;
  let previousRegime: CanonicalMarketRegime | null = null;
  let transitionCount = 0;
  let transitionIntervalReturnSum = 0;
  let transitionIntervalCount = 0;
  const transitionCounts = new Map<string, RegimeTransition>();

  for (let candleIndex = Math.max(config.lookback, evaluationStartIndex); candleIndex < candles.length; candleIndex += 1) {
    const curveIndex = candleIndex - evaluationStartIndex + 1;
    const previousPoint = equityCurve[curveIndex - 1];
    const currentPoint = equityCurve[curveIndex];
    if (!previousPoint || !currentPoint || currentPoint.time !== candles[candleIndex].closeTime) {
      throw new Error("Equity curve timestamps do not align with the validated candle series");
    }
    if (!Number.isFinite(previousPoint.equity) || previousPoint.equity <= 0 ||
        !Number.isFinite(currentPoint.equity) || currentPoint.equity <= 0) {
      throw new Error("Non-finite or non-positive marked equity; regime analytics withheld");
    }
    const intervalReturn = currentPoint.equity / previousPoint.equity - 1;
    if (!Number.isFinite(intervalReturn)) {
      throw new Error("Non-finite interval return; regime analytics withheld");
    }

    const regime = classifyMarketRegimeWindow(
      candles.slice(candleIndex - config.lookback, candleIndex + 1),
      {
        interval: config.interval,
        lookback: config.lookback,
        trendThresholdBps: config.trendThresholdBps,
        rangeThresholdBps: config.rangeThresholdBps,
        highVolatilityThresholdBps: config.highVolatilityThresholdBps,
      },
    ).regime;
    classifiedCandles += 1;
    const bucket = observationsByRegime.get(regime)!;
    bucket.push({ value: intervalReturn, regime, index: candleIndex });

    if (previousRegime !== null && previousRegime !== regime) {
      transitionCount += 1;
      transitionIntervalReturnSum += intervalReturn;
      transitionIntervalCount += 1;
      const key = `${previousRegime}->${regime}`;
      const existing = transitionCounts.get(key);
      transitionCounts.set(key, existing
        ? { ...existing, count: existing.count + 1 }
        : { from: previousRegime, to: regime, count: 1 });
    }
    previousRegime = regime;
  }

  const buckets = REGIMES.map(regime => summarizeBucket(
    regime,
    observationsByRegime.get(regime)!,
    tradeCountByRegime.get(regime) ?? 0,
    config.interval,
    classifiedCandles,
  ));
  const totalIntervals = Math.max(0, classifiedCandles - 1);
  const transitionRatePct = totalIntervals > 0 ? transitionCount / totalIntervals * 100 : null;

  return {
    status: classifiedCandles > 0 ? "ready" : "insufficient_data",
    observations: classifiedCandles,
    classifiedCandles,
    currentRegime: previousRegime,
    transitionCount,
    transitionRatePct: Number.isFinite(transitionRatePct) ? transitionRatePct : null,
    transitionIntervalReturnPct: transitionIntervalCount > 0 &&
      Number.isFinite(transitionIntervalReturnSum / transitionIntervalCount * 100)
      ? transitionIntervalReturnSum / transitionIntervalCount * 100 : null,
    transitionIntervalCount,
    buckets,
    transitions: [...transitionCounts.values()].sort((a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    methodology: [
      "Each close-to-close marked-equity return is assigned to the canonical regime classified using the current candle close; this is an after-close descriptive attribution, not a predictive signal.",
      "Regime volatility, Sharpe and Sortino require at least 30 valid interval returns. Annualization adjusts the selected interval frequency by the observed share of intervals assigned to that regime; this is a descriptive frequency approximation. Sharpe uses a 0% risk-free rate and Sortino a 0% target.",
      "Sample status is insufficient below 5 observations, limited from 5 to 29, and adequate at 30 or more; these are display thresholds, not statistical significance tests.",
      "Maximum drawdown is the largest drawdown inside any uninterrupted episode of a regime. Separate episodes are not concatenated.",
      "Transition interval returns are reported separately for intervals where the canonical regime label changes.",
      "Trade counts are baseline trades attributed to the regime at entry; they are not the same population as candle-interval observations.",
      "Only the backtest evaluation window is measured. No missing candles or equity observations are synthesized.",
      "This is historical research only; it does not select, switch, or authorize strategies and does not create PAPER or LIVE orders.",
    ],
  };
}
