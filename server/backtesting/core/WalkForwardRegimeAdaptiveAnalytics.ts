import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import { classifyMarketRegimeWindow, type CanonicalMarketRegime } from "../../market-regime/core/MarketRegimeClassifier";

export type RegimeAdaptiveFold = {
  index: number;
  strategyReturnPct: number | null;
  buyAndHoldGrossReturnPct: number | null;
  excessReturnPctPoints: number | null;
  observations: number;
  sampleStatus: "insufficient_sample" | "limited_sample" | "adequate_sample";
  strategyOutperformed: boolean | null;
};

export type RegimeAdaptiveBucket = {
  regime: CanonicalMarketRegime;
  observations: number;
  sampleStatus: "insufficient_sample" | "limited_sample" | "adequate_sample";
  foldsObserved: number;
  positiveExcessFolds: number;
  excessPositiveFoldSharePct: number | null;
  medianStrategyReturnPct: number | null;
  medianBuyAndHoldGrossReturnPct: number | null;
  medianExcessReturnPctPoints: number | null;
  worstExcessReturnPctPoints: number | null;
  foldResults: RegimeAdaptiveFold[];
};

export type WalkForwardRegimeAdaptiveAnalytics = {
  status: "ready" | "insufficient_history";
  benchmark: "buy_and_hold_gross_price_return";
  benchmarkCaveat: string;
  buckets: RegimeAdaptiveBucket[];
};

export type WalkForwardRegimeAdaptiveSummary = {
  status: "ready" | "insufficient_folds";
  totalFolds: number;
  benchmark: "buy_and_hold_gross_price_return";
  benchmarkCaveat: string;
  buckets: Array<RegimeAdaptiveBucket & { foldCoveragePct: number }>;
};

export type RegimeAdaptiveConfig = {
  interval: MarketInterval;
  lookback: number;
  trendThresholdBps: number;
  rangeThresholdBps: number;
  highVolatilityThresholdBps: number;
};

const REGIMES: CanonicalMarketRegime[] = [
  "uptrend", "downtrend", "ranging", "high_volatility", "transition",
];

function median(values: number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sampleStatus(count: number): RegimeAdaptiveBucket["sampleStatus"] {
  return count < 5 ? "insufficient_sample" : count < 30 ? "limited_sample" : "adequate_sample";
}

/**
 * Compares net strategy marked-equity returns with gross underlying-asset price returns
 * inside each causal OOS regime. Benchmark returns are descriptive and exclude fees,
 * slippage, spread and financing; they are not an execution-matched portfolio benchmark.
 */
export function analyzeWalkForwardRegimeAdaptive(
  candles: MarketCandle[],
  validationStartIndex: number,
  strategyEquityCurve: Array<{ time: number; equity: number }>,
  foldIndex: number,
  config: RegimeAdaptiveConfig,
): WalkForwardRegimeAdaptiveAnalytics {
  const grouped = new Map<CanonicalMarketRegime, {
    strategy: number[];
    benchmark: number[];
    excess: number[];
  }>(REGIMES.map(regime => [regime, { strategy: [], benchmark: [], excess: [] }]));

  if (!Number.isInteger(foldIndex) || foldIndex < 1) {
    throw new Error("Regime adaptive fold index must be a positive integer");
  }
  if (!Number.isInteger(validationStartIndex) || validationStartIndex < config.lookback + 1 ||
      strategyEquityCurve.length < 2) {
    return {
      status: "insufficient_history",
      benchmark: "buy_and_hold_gross_price_return",
      benchmarkCaveat: "Underlying price return only; excludes trading costs and is not exposure-matched.",
      buckets: REGIMES.map(regime => ({
        regime, observations: 0, sampleStatus: "insufficient_sample", foldsObserved: 0,
        positiveExcessFolds: 0, excessPositiveFoldSharePct: null,
        medianStrategyReturnPct: null, medianBuyAndHoldGrossReturnPct: null,
        medianExcessReturnPctPoints: null, worstExcessReturnPctPoints: null, foldResults: [],
      })),
    };
  }

  for (let curveIndex = 1; curveIndex < strategyEquityCurve.length; curveIndex += 1) {
    const priorCandleIndex = validationStartIndex + curveIndex - 2;
    const currentCandle = candles[priorCandleIndex + 1];
    const priorCandle = candles[priorCandleIndex];
    const previousEquity = strategyEquityCurve[curveIndex - 1].equity;
    const currentEquity = strategyEquityCurve[curveIndex].equity;
    if (!priorCandle || !currentCandle ||
        strategyEquityCurve[curveIndex].time !== currentCandle.closeTime ||
        !Number.isFinite(previousEquity) || previousEquity <= 0 ||
        !Number.isFinite(currentEquity) || currentEquity <= 0) {
      throw new Error("Regime adaptive inputs are not aligned to valid OOS equity and candle data");
    }

    const regimeWindow = candles.slice(priorCandleIndex - config.lookback, priorCandleIndex + 1);
    const regime = classifyMarketRegimeWindow(regimeWindow, config).regime;
    const strategyReturn = currentEquity / previousEquity - 1;
    const priorClose = Number(priorCandle.close);
    const currentPrice = Number(currentCandle.close);
    const benchmarkBase = curveIndex === 1 ? Number(currentCandle.open) : priorClose;
    const benchmarkReturn = currentPrice / benchmarkBase - 1;
    if (!Number.isFinite(strategyReturn) || !Number.isFinite(benchmarkReturn) ||
        !Number.isFinite(priorClose) || priorClose <= 0 ||
        !Number.isFinite(benchmarkBase) || benchmarkBase <= 0 ||
        !Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new Error("Non-finite regime adaptive return; analytics withheld");
    }
    const group = grouped.get(regime)!;
    group.strategy.push(strategyReturn);
    group.benchmark.push(benchmarkReturn);
    group.excess.push(strategyReturn - benchmarkReturn);
  }

  const buckets = REGIMES.map(regime => {
    const values = grouped.get(regime)!;
    const observations = values.strategy.length;
    const strategyGross = values.strategy.reduce((product, value) => product * (1 + value), 1);
    const benchmarkGross = values.benchmark.reduce((product, value) => product * (1 + value), 1);
    if (!Number.isFinite(strategyGross) || !Number.isFinite(benchmarkGross)) {
      throw new Error("Non-finite regime adaptive compounded return; analytics withheld");
    }
    const excessReturns = values.excess;
    const excessPct = excessReturns.map(value => value * 100);
    const strategyPct = (strategyGross - 1) * 100;
    const benchmarkPct = (benchmarkGross - 1) * 100;
    const foldResults: RegimeAdaptiveFold[] = observations > 0 ? [{
      index: foldIndex,
      strategyReturnPct: Number.isFinite(strategyPct) ? strategyPct : null,
      buyAndHoldGrossReturnPct: Number.isFinite(benchmarkPct) ? benchmarkPct : null,
      excessReturnPctPoints: Number.isFinite(strategyPct - benchmarkPct) ? strategyPct - benchmarkPct : null,
      observations,
      sampleStatus: sampleStatus(observations),
      strategyOutperformed: Number.isFinite(strategyPct - benchmarkPct) ? strategyPct > benchmarkPct : null,
    }] : [];
    const excessFold = foldResults[0]?.excessReturnPctPoints;
    return {
      regime,
      observations,
      sampleStatus: sampleStatus(observations),
      foldsObserved: foldResults.length,
      positiveExcessFolds: excessFold !== undefined && excessFold !== null && excessFold > 0 ? 1 : 0,
      excessPositiveFoldSharePct: excessFold === undefined || excessFold === null ? null : excessFold > 0 ? 100 : 0,
      medianStrategyReturnPct: median(foldResults.flatMap(item => item.strategyReturnPct === null ? [] : [item.strategyReturnPct])),
      medianBuyAndHoldGrossReturnPct: median(foldResults.flatMap(item => item.buyAndHoldGrossReturnPct === null ? [] : [item.buyAndHoldGrossReturnPct])),
      medianExcessReturnPctPoints: median(foldResults.flatMap(item => item.excessReturnPctPoints === null ? [] : [item.excessReturnPctPoints])),
      worstExcessReturnPctPoints: foldResults.length ? Math.min(...foldResults.flatMap(item => item.excessReturnPctPoints === null ? [] : [item.excessReturnPctPoints])) : null,
      foldResults,
    };
  });

  return {
    status: "ready",
    benchmark: "buy_and_hold_gross_price_return",
    benchmarkCaveat: "Underlying price return only; excludes trading costs, spread, slippage, fees and financing. It is not exposure-matched; comparisons are directional diagnostics, not like-for-like strategy rankings.",
    buckets,
  };
}


/** Aggregates only fold-local regime outcomes; no interval or equity-curve pooling. */
export function aggregateWalkForwardRegimeAdaptive(
  folds: WalkForwardRegimeAdaptiveAnalytics[],
): WalkForwardRegimeAdaptiveSummary {
  const ready = folds.filter(fold => fold.status === "ready");
  const totalFolds = folds.length;
  const buckets = REGIMES.map(regime => {
    const foldResults = ready.flatMap(fold =>
      fold.buckets.find(bucket => bucket.regime === regime)?.foldResults ?? [],
    );
    const observations = foldResults.reduce((sum, item) => sum + item.observations, 0);
    const strategies = foldResults.flatMap(item => item.strategyReturnPct === null ? [] : [item.strategyReturnPct]);
    const benchmarks = foldResults.flatMap(item => item.buyAndHoldGrossReturnPct === null ? [] : [item.buyAndHoldGrossReturnPct]);
    const excess = foldResults.flatMap(item => item.excessReturnPctPoints === null ? [] : [item.excessReturnPctPoints]);
    const positive = excess.filter(value => value > 0).length;
    return {
      regime,
      observations,
      sampleStatus: sampleStatus(observations),
      foldsObserved: foldResults.length,
      foldCoveragePct: totalFolds > 0 ? foldResults.length / totalFolds * 100 : 0,
      positiveExcessFolds: positive,
      excessPositiveFoldSharePct: excess.length >= 2 ? positive / excess.length * 100 : null,
      medianStrategyReturnPct: median(strategies),
      medianBuyAndHoldGrossReturnPct: median(benchmarks),
      medianExcessReturnPctPoints: median(excess),
      worstExcessReturnPctPoints: excess.length ? Math.min(...excess) : null,
      foldResults,
    };
  });
  return {
    status: ready.length >= 2 ? "ready" : "insufficient_folds",
    totalFolds,
    benchmark: "buy_and_hold_gross_price_return",
    benchmarkCaveat: "Underlying price return only; excludes trading costs, spread, slippage, fees and financing. It is not exposure-matched; comparisons are directional diagnostics, not like-for-like strategy rankings.",
    buckets,
  };
}
