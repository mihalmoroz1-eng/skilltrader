import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import {
  classifyMarketRegimeWindow,
  type CanonicalMarketRegime,
} from "../../market-regime/core/MarketRegimeClassifier";

export type WalkForwardRegimeConfig = {
  interval: MarketInterval;
  lookback: number;
  trendThresholdBps: number;
  rangeThresholdBps: number;
  highVolatilityThresholdBps: number;
};

export type WalkForwardRegimeBucket = {
  regime: CanonicalMarketRegime;
  observations: number;
  sampleStatus: "insufficient_sample" | "limited_sample" | "adequate_sample";
  compoundedReturnPct: number | null;
  annualizedVolatilityPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxEpisodeDrawdownPct: number | null;
  episodeCount: number;
};

export type WalkForwardRegimeTransition = {
  from: CanonicalMarketRegime;
  to: CanonicalMarketRegime;
  count: number;
};

export type WalkForwardRegimePerformance = {
  status: "ready" | "insufficient_history";
  observations: number;
  currentRegime: CanonicalMarketRegime | null;
  transitionCount: number;
  transitionRatePct: number | null;
  transitionIntervalReturnPct: number | null;
  buckets: WalkForwardRegimeBucket[];
  transitions: WalkForwardRegimeTransition[];
};

const REGIMES: CanonicalMarketRegime[] = [
  "uptrend", "downtrend", "ranging", "high_volatility", "transition",
];

const INTERVAL_MS: Partial<Record<MarketInterval, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
  "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000,
  "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

function periodsPerYear(interval: MarketInterval): number {
  return interval === "1M" ? 12 : 365.2425 * 86_400_000 / (INTERVAL_MS[interval] ?? 0);
}

type Observation = { value: number; index: number };

function summarize(
  regime: CanonicalMarketRegime,
  observations: Observation[],
  interval: MarketInterval,
  totalObservations: number,
): WalkForwardRegimeBucket {
  const values = observations.map(item => item.value);
  const count = values.length;
  const grossFactor = values.reduce((factor, value) => factor * (1 + value), 1);
  if (!Number.isFinite(grossFactor)) throw new Error("Non-finite regime compounded return; fold analytics withheld");
  const sampleStatus = count < 5 ? "insufficient_sample"
    : count < 30 ? "limited_sample" : "adequate_sample";
  const frequencyAdjustedPeriods = periodsPerYear(interval) *
    (totalObservations > 0 ? count / totalObservations : 0);
  let annualizedVolatilityPct: number | null = null;
  let sharpeRatio: number | null = null;
  let sortinoRatio: number | null = null;

  if (count >= 30 && Number.isFinite(frequencyAdjustedPeriods) && frequencyAdjustedPeriods > 0) {
    const average = values.reduce((sum, value) => sum + value, 0) / count;
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (count - 1);
    const volatility = Math.sqrt(variance);
    const downside = Math.sqrt(values.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / count);
    const annualization = Math.sqrt(frequencyAdjustedPeriods);
    const annualized = volatility * annualization * 100;
    if (Number.isFinite(annualized)) annualizedVolatilityPct = annualized;
    if (volatility > 0) {
      const sharpe = average / volatility * annualization;
      if (Number.isFinite(sharpe)) sharpeRatio = sharpe;
    }
    if (downside > 0) {
      const sortino = average / downside * annualization;
      if (Number.isFinite(sortino)) sortinoRatio = sortino;
    }
  }

  let episodeCount = 0;
  let episodeEquity = 1;
  let peak = 1;
  let maxEpisodeDrawdownPct = 0;
  let previousIndex = -2;
  for (const item of observations) {
    if (item.index !== previousIndex + 1) {
      episodeCount += 1;
      episodeEquity = 1;
      peak = 1;
    }
    episodeEquity *= 1 + item.value;
    if (!Number.isFinite(episodeEquity)) throw new Error("Non-finite regime episode equity; fold analytics withheld");
    peak = Math.max(peak, episodeEquity);
    if (peak > 0) maxEpisodeDrawdownPct = Math.max(
      maxEpisodeDrawdownPct, (peak - episodeEquity) / peak * 100,
    );
    previousIndex = item.index;
  }

  return {
    regime,
    observations: count,
    sampleStatus,
    compoundedReturnPct: count > 0 && Number.isFinite((grossFactor - 1) * 100)
      ? (grossFactor - 1) * 100 : null,
    annualizedVolatilityPct,
    sharpeRatio,
    sortinoRatio,
    maxEpisodeDrawdownPct: count > 0 ? maxEpisodeDrawdownPct : null,
    episodeCount,
  };
}

/**
 * Assigns each validation close-to-close return to the regime already known at
 * the previous close. The first validation interval uses the final training candle.
 * This deliberately avoids classifying a return with information from its own close.
 */
export function analyzeWalkForwardRegimes(
  candles: MarketCandle[],
  validationStartIndex: number,
  equityCurve: Array<{ time: number; equity: number }>,
  config: WalkForwardRegimeConfig,
): WalkForwardRegimePerformance {
  const empty = (): WalkForwardRegimePerformance => ({
    status: "insufficient_history",
    observations: 0,
    currentRegime: null,
    transitionCount: 0,
    transitionRatePct: null,
    transitionIntervalReturnPct: null,
    buckets: REGIMES.map(regime => summarize(regime, [], config.interval, 0)),
    transitions: [],
  });
  if (!Number.isInteger(validationStartIndex) || validationStartIndex < config.lookback + 1 ||
      equityCurve.length < 2) return empty();

  const byRegime = new Map<CanonicalMarketRegime, Observation[]>(
    REGIMES.map(regime => [regime, []]),
  );
  const transitionsByPair = new Map<string, WalkForwardRegimeTransition>();
  let previousRegime: CanonicalMarketRegime | null = null;
  let transitionCount = 0;
  let transitionReturnSum = 0;
  let transitionIntervalCount = 0;

  for (let curveIndex = 1; curveIndex < equityCurve.length; curveIndex += 1) {
    const candleIndex = validationStartIndex + curveIndex - 2;
    const previous = equityCurve[curveIndex - 1];
    const current = equityCurve[curveIndex];
    const returnCandle = candles[candleIndex + 1];
    if (!returnCandle || current.time !== returnCandle.closeTime) {
      throw new Error("Walk-forward equity timestamps do not align with validation candles");
    }
    if (!Number.isFinite(previous.equity) || previous.equity <= 0 ||
        !Number.isFinite(current.equity) || current.equity <= 0) {
      throw new Error("Invalid marked equity; walk-forward regime analytics withheld");
    }
    const intervalReturn = current.equity / previous.equity - 1;
    if (!Number.isFinite(intervalReturn)) {
      throw new Error("Non-finite validation interval return; regime analytics withheld");
    }

    const windowStart = candleIndex - config.lookback;
    const windowEnd = candleIndex;
    if (windowStart < 0 || windowEnd >= candles.length) return empty();
    const regime = classifyMarketRegimeWindow(
      candles.slice(windowStart, windowEnd + 1),
      {
        interval: config.interval,
        lookback: config.lookback,
        trendThresholdBps: config.trendThresholdBps,
        rangeThresholdBps: config.rangeThresholdBps,
        highVolatilityThresholdBps: config.highVolatilityThresholdBps,
      },
    ).regime;
    byRegime.get(regime)!.push({ value: intervalReturn, index: curveIndex });

    if (previousRegime !== null && previousRegime !== regime) {
      transitionCount += 1;
      transitionReturnSum += intervalReturn;
      transitionIntervalCount += 1;
      const key = `${previousRegime}->${regime}`;
      const old = transitionsByPair.get(key);
      transitionsByPair.set(key, old
        ? { ...old, count: old.count + 1 }
        : { from: previousRegime, to: regime, count: 1 });
    }
    previousRegime = regime;
  }

  const observations = equityCurve.length - 1;
  const buckets = REGIMES.map(regime =>
    summarize(regime, byRegime.get(regime)!, config.interval, observations));
  const transitionRatePct = observations > 1
    ? transitionCount / (observations - 1) * 100 : null;
  const transitionIntervalReturnPct = transitionIntervalCount > 0
    ? transitionReturnSum / transitionIntervalCount * 100 : null;
  if ((transitionRatePct !== null && !Number.isFinite(transitionRatePct)) ||
      (transitionIntervalReturnPct !== null && !Number.isFinite(transitionIntervalReturnPct))) {
    throw new Error("Non-finite transition metric; regime analytics withheld");
  }

  return {
    status: "ready",
    observations,
    currentRegime: previousRegime,
    transitionCount,
    transitionRatePct,
    transitionIntervalReturnPct,
    buckets,
    transitions: [...transitionsByPair.values()].sort((a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}
