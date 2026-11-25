import { createHash } from "node:crypto";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import {
  runWalkForwardValidation,
  type WalkForwardValidationConfig,
  type WalkForwardValidationResult,
} from "./WalkForwardValidationEngine";
import { WalkForwardInputError } from "./WalkForwardValidationEngine";

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
  validation: WalkForwardValidationResult;
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
      })),
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
    candlesProcessed: strategies[0].validation.candlesProcessed,
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
