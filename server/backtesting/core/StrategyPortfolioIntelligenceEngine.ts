import { createHash } from "node:crypto";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import {
  runWalkForwardValidation,
  WalkForwardInputError,
  type WalkForwardValidationConfig,
  type WalkForwardValidationResult,
} from "./WalkForwardValidationEngine";
import type { CanonicalMarketRegime } from "../../market-regime/core/MarketRegimeClassifier";
import type { WalkForwardRegimeBucket } from "./WalkForwardRegimeAnalytics";

export type StrategyPortfolioConfig = Omit<WalkForwardValidationConfig, "strategy">;

export type StrategyPortfolioEntry = {
  strategy: "ema_crossover" | "rsi_mean_reversion" | "macd_momentum" | "breakout";
  runId: string;
  dataDigest: string;
  folds: Array<{
    index: number;
    validationStartTime: number;
    validationEndTime: number;
    trainingReturnPct: number;
    validationReturnPct: number;
    maxDrawdownPct: number;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    totalTrades: number;
    regimes: WalkForwardRegimeBucket[];
  }>;
  regimeSummary: Array<{
    regime: CanonicalMarketRegime;
    foldsObserved: number;
    totalFolds: number;
    observations: number;
    adequateSampleFolds: number;
    positiveReturnFolds: number;
    positiveReturnSharePct: number | null;
    medianConditionalReturnPct: number | null;
    worstEpisodeDrawdownPct: number | null;
    averageAnnualizedVolatilityPct: number | null;
    averageSharpeRatio: number | null;
    averageSortinoRatio: number | null;
  }>;
  metrics: {
    averageValidationReturnPct: number;
    medianValidationReturnPct: number;
    validationReturnStdDevPct: number;
    positiveValidationWindows: number;
    positiveValidationWindowPct: number;
    worstValidationDrawdownPct: number;
    totalValidationTrades: number;
    averageValidationSharpe: number | null;
    averageValidationSortino: number | null;
    riskAdjustedFoldCount: number;
  };
};

export type StrategyPortfolioIntelligenceResult = {
  runId: string;
  dataDigest: string;
  symbol: string;
  interval: WalkForwardValidationConfig["interval"];
  candlesProcessed: number;
  strategies: StrategyPortfolioEntry[];
  methodology: string[];
  executionEligible: false;
  exchangeOrderSent: false;
};

export class StrategyPortfolioInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyPortfolioInputError";
  }
}

const STRATEGIES = ["ema_crossover", "rsi_mean_reversion", "macd_momentum", "breakout"] as const;
const REGIMES: CanonicalMarketRegime[] = [
  "uptrend", "downtrend", "ranging", "high_volatility", "transition",
];

function finiteValues(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function median(values: number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  if (values.length < 2) return null;
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Number.isFinite(value) ? value : null;
}

function summarizeRegimes(
  windows: WalkForwardValidationResult["windows"],
): StrategyPortfolioEntry["regimeSummary"] {
  return REGIMES.map(regime => {
    const buckets = windows.flatMap(window => {
      const bucket = window.validation.regimePerformance.buckets.find(item => item.regime === regime);
      return bucket && bucket.observations > 0 ? [bucket] : [];
    });
    const returns = finiteValues(buckets.map(bucket => bucket.compoundedReturnPct));
    const volatilities = finiteValues(buckets.map(bucket => bucket.annualizedVolatilityPct));
    const sharpes = finiteValues(buckets.map(bucket => bucket.sharpeRatio));
    const sortinos = finiteValues(buckets.map(bucket => bucket.sortinoRatio));
    const drawdowns = finiteValues(buckets.map(bucket => bucket.maxEpisodeDrawdownPct));
    return {
      regime,
      foldsObserved: buckets.length,
      totalFolds: windows.length,
      observations: buckets.reduce((sum, bucket) => sum + bucket.observations, 0),
      adequateSampleFolds: buckets.filter(bucket => bucket.sampleStatus === "adequate_sample").length,
      positiveReturnFolds: returns.filter(value => value > 0).length,
      positiveReturnSharePct: returns.length >= 2
        ? returns.filter(value => value > 0).length / returns.length * 100 : null,
      medianConditionalReturnPct: median(returns),
      worstEpisodeDrawdownPct: drawdowns.length > 0 ? Math.max(...drawdowns) : null,
      averageAnnualizedVolatilityPct: mean(volatilities),
      averageSharpeRatio: mean(sharpes),
      averageSortinoRatio: mean(sortinos),
    };
  });
}

function strategyWarmup(config: StrategyPortfolioConfig, strategy: typeof STRATEGIES[number]): number {
  switch (strategy) {
    case "ema_crossover": return config.slowEmaPeriod + 2;
    case "rsi_mean_reversion": return (config.rsiPeriod ?? 14) + 3;
    case "macd_momentum": return (config.macdSlowPeriod ?? 26) + (config.macdSignalPeriod ?? 9) + 1;
    case "breakout": return (config.breakoutLookbackPeriod ?? 20) + 2;
  }
}

function summarize(result: WalkForwardValidationResult): StrategyPortfolioEntry["metrics"] {
  return {
    averageValidationReturnPct: result.metrics.averageValidationReturnPct,
    medianValidationReturnPct: result.metrics.medianValidationReturnPct,
    validationReturnStdDevPct: result.metrics.validationReturnStdDevPct,
    positiveValidationWindows: result.metrics.positiveValidationWindows,
    positiveValidationWindowPct: result.metrics.positiveValidationWindowPct,
    worstValidationDrawdownPct: result.metrics.worstValidationDrawdownPct,
    totalValidationTrades: result.metrics.totalValidationTrades,
    averageValidationSharpe: result.metrics.averageValidationSharpe,
    averageValidationSortino: result.metrics.averageValidationSortino,
    riskAdjustedFoldCount: result.metrics.riskAdjustedFoldCount,
  };
}

/**
 * Runs all four fixed strategies on the same candles and identical rolling OOS boundaries.
 * This is a side-by-side research comparison, not a combined capital portfolio or a strategy selector.
 */
export function runStrategyPortfolioIntelligence(
  candles: MarketCandle[],
  config: StrategyPortfolioConfig,
): StrategyPortfolioIntelligenceResult {
  const maximumWarmup = Math.max(...STRATEGIES.map(strategy => strategyWarmup(config, strategy)));
  if (!Number.isInteger(config.trainingCandles) || config.trainingCandles < Math.max(maximumWarmup, config.regimeLookback + 1)) {
    throw new StrategyPortfolioInputError("Training window must cover the warm-up requirements of all four strategies and the regime lookback");
  }

  const strategies: StrategyPortfolioEntry[] = STRATEGIES.map(strategy => {
    const strategyConfig: WalkForwardValidationConfig = {
      ...config,
      strategy,
    };
    let validation: WalkForwardValidationResult;
    try {
      validation = runWalkForwardValidation(candles, strategyConfig);
    } catch (error) {
      if (error instanceof WalkForwardInputError) {
        throw new StrategyPortfolioInputError(error.message);
      }
      throw error;
    }
    return {
      strategy,
      runId: validation.runId,
      dataDigest: validation.dataDigest,
      folds: validation.windows.map(window => ({
        index: window.index,
        validationStartTime: window.validationStartTime,
        validationEndTime: window.validationEndTime,
        trainingReturnPct: window.training.returnPct,
        validationReturnPct: window.validation.returnPct,
        maxDrawdownPct: window.validation.maxDrawdownPct,
        sharpeRatio: window.validation.sharpeRatio,
        sortinoRatio: window.validation.sortinoRatio,
        totalTrades: window.validation.totalTrades,
        regimes: window.validation.regimePerformance.buckets,
      })),
      regimeSummary: summarizeRegimes(validation.windows),
      metrics: summarize(validation),
    };
  });

  const dataDigest = strategies[0].dataDigest;
  if (strategies.some(item => item.dataDigest !== dataDigest)) {
    throw new StrategyPortfolioInputError("Strategy runs did not use identical historical data");
  }
  const runId = createHash("sha256").update(JSON.stringify({
    symbol: config.symbol,
    interval: config.interval,
    config,
    dataDigest,
    strategyRunIds: strategies.map(item => item.runId),
  })).digest("hex").slice(0, 24);

  return {
    runId,
    dataDigest,
    symbol: config.symbol,
    interval: config.interval,
    candlesProcessed: config.trainingCandles + (config.windowCount - 1) * config.stepCandles + config.validationCandles,
    strategies,
    methodology: [
      "All four fixed strategies use the exact same validated contiguous closed-candle series, training lengths, validation boundaries, starting capital, risk limits, fees and adverse slippage.",
      "The common training window must cover the largest warm-up requirement across EMA, RSI, MACD and Breakout, plus the regime classifier lookback.",
      "Every strategy is evaluated independently in each out-of-sample fold with fresh virtual capital; no positions or PnL carry between folds or strategies.",
      "Cross-strategy results are side-by-side diagnostics. Returns are not added, compounded together or represented as a combined portfolio equity curve.",
      "No strategy is ranked, selected, optimized, automatically switched or connected to PAPER/LIVE execution.",
      "All results are historical research only. executionEligible=false and exchangeOrderSent=false.",
    ],
    executionEligible: false,
    exchangeOrderSent: false,
  };
}
