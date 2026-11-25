import { createHash } from "node:crypto";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import {
  runBacktest,
  validateBacktestCandleSeries,
  type BacktestConfig,
} from "./BacktestEngine";

export type WalkForwardValidationConfig = Omit<BacktestConfig, "evaluationStartIndex"> & {
  trainingCandles: number;
  validationCandles: number;
  stepCandles: number;
  windowCount: number;
};

export type WalkForwardWindowResult = {
  index: number;
  trainingStartTime: number;
  trainingEndTime: number;
  validationStartTime: number;
  validationEndTime: number;
  training: {
    runId: string;
    dataDigest: string;
    returnPct: number;
    maxDrawdownPct: number;
    totalTrades: number;
    winRatePct: number;
  };
  validation: {
    runId: string;
    dataDigest: string;
    returnPct: number;
    netProfit: number;
    maxDrawdownPct: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRatePct: number;
    netWinningTradePnl: number;
    netLosingTradePnl: number;
    firstTradeEntryTime: number | null;
    lastTradeExitTime: number | null;
    riskMetricObservations: number;
    annualizedVolatilityPct: number | null;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    returnToMaxDrawdown: number | null;
  };
};

export type WalkForwardValidationResult = {
  runId: string;
  dataDigest: string;
  symbol: string;
  interval: BacktestConfig["interval"];
  strategy: "ema_crossover";
  candlesProcessed: number;
  windows: WalkForwardWindowResult[];
  metrics: {
    windowCount: number;
    averageTrainingReturnPct: number;
    averageValidationReturnPct: number;
    medianValidationReturnPct: number;
    validationReturnStdDevPct: number;
    validationMinusTrainingReturnPct: number;
    positiveValidationWindows: number;
    positiveValidationWindowPct: number;
    worstValidationDrawdownPct: number;
    totalValidationTrades: number;
    validationWinRatePct: number;
    validationProfitFactor: number | null;
    riskAdjustedFoldCount: number;
    averageValidationSharpe: number | null;
    medianValidationSharpe: number | null;
    worstValidationSharpe: number | null;
    validationSharpeStdDev: number | null;
    averageValidationSortino: number | null;
    medianValidationSortino: number | null;
    worstValidationSortino: number | null;
    validationSortinoStdDev: number | null;
  };
  assumptions: string[];
  executionEligible: false;
};

export class WalkForwardInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalkForwardInputError";
  }
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

const MIN_RISK_OBSERVATIONS = 30;
const INTERVAL_MS: Partial<Record<BacktestConfig["interval"], number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};

function annualizationPeriods(interval: BacktestConfig["interval"]): number {
  return interval === "1M" ? 12 : 365.2425 * 86_400_000 / (INTERVAL_MS[interval] ?? 0);
}

function foldRiskMetrics(
  curve: Array<{ time: number; equity: number }>,
  interval: BacktestConfig["interval"],
  totalReturnPct: number,
  maxDrawdownPct: number,
) {
  const unavailable = {
    riskMetricObservations: 0,
    annualizedVolatilityPct: null,
    sharpeRatio: null,
    sortinoRatio: null,
    returnToMaxDrawdown: maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : null,
  };
  const returns: number[] = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1].equity;
    const current = curve[index].equity;
    if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current) || current <= 0) {
      return { ...unavailable, riskMetricObservations: returns.length };
    }
    returns.push(current / previous - 1);
  }
  const periods = annualizationPeriods(interval);
  if (returns.length < MIN_RISK_OBSERVATIONS || !Number.isFinite(periods) || periods <= 0) {
    return { ...unavailable, riskMetricObservations: returns.length };
  }
  const average = mean(returns);
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1);
  const volatility = Math.sqrt(variance);
  const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / returns.length);
  return {
    riskMetricObservations: returns.length,
    annualizedVolatilityPct: Number.isFinite(volatility) ? volatility * Math.sqrt(periods) * 100 : null,
    sharpeRatio: volatility > 0 ? average / volatility * Math.sqrt(periods) : null,
    sortinoRatio: downside > 0 ? average / downside * Math.sqrt(periods) : null,
    returnToMaxDrawdown: maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : null,
  };
}

function aggregateFoldMetric(values: Array<number | null>, mode: "average" | "median" | "worst" | "stddev"): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (valid.length < 2) return null;
  if (mode === "average") return mean(valid);
  if (mode === "median") return median(valid);
  if (mode === "worst") return Math.min(...valid);
  return standardDeviation(valid);
}

export function runWalkForwardValidation(
  candles: MarketCandle[],
  config: WalkForwardValidationConfig,
): WalkForwardValidationResult {
  if (!Number.isInteger(config.trainingCandles) ||
      config.trainingCandles < config.slowEmaPeriod + 2 ||
      config.trainingCandles > 30_000) {
    throw new WalkForwardInputError("Training window must include the EMA warm-up and at least two completed candles");
  }
  if (!Number.isInteger(config.validationCandles) ||
      config.validationCandles < 10 || config.validationCandles > 10_000) {
    throw new WalkForwardInputError("Validation window must contain from 10 to 10,000 candles");
  }
  if (!Number.isInteger(config.stepCandles) ||
      config.stepCandles < config.validationCandles || config.stepCandles > 10_000) {
    throw new WalkForwardInputError("Walk-forward step must be at least the validation window to prevent overlapping out-of-sample data");
  }
  if (!Number.isInteger(config.windowCount) || config.windowCount < 2 || config.windowCount > 12) {
    throw new WalkForwardInputError("Walk-forward requires from 2 to 12 windows");
  }
  const requiredCandles = config.trainingCandles +
    (config.windowCount - 1) * config.stepCandles + config.validationCandles;
  if (requiredCandles > 50_000) {
    throw new WalkForwardInputError("Walk-forward is limited to 50,000 candles across all windows");
  }
  if (candles.length > 50_000) {
    throw new WalkForwardInputError("Walk-forward is limited to 50,000 supplied candles");
  }
  if (candles.length < requiredCandles) {
    throw new WalkForwardInputError(
      `Insufficient history: ${requiredCandles} candles are required for the requested windows`,
    );
  }

  // Use the most recent complete rolling sequence; every validation segment remains out of sample.
  const selectedCandles = candles.slice(candles.length - requiredCandles);
  validateBacktestCandleSeries(selectedCandles, config.interval);

  const {
    trainingCandles, validationCandles, stepCandles, windowCount,
    ...backtestConfig
  } = config;
  const windows: WalkForwardWindowResult[] = [];

  for (let fold = 0; fold < windowCount; fold += 1) {
    const trainingStartIndex = fold * stepCandles;
    const validationStartIndex = trainingStartIndex + trainingCandles;
    const validationEndIndex = validationStartIndex + validationCandles;
    const training = selectedCandles.slice(trainingStartIndex, validationStartIndex);
    const trainingAndValidation = selectedCandles.slice(trainingStartIndex, validationEndIndex);

    // Training metrics are diagnostic only. Validation starts with a fresh virtual account,
    // while the training candles are retained solely to warm up indicators and form the
    // last completed-candle signal that may be filled at the first validation candle open.
    const trainingResult = runBacktest(training, backtestConfig);
    const validationResult = runBacktest(trainingAndValidation, {
      ...backtestConfig,
      evaluationStartIndex: trainingCandles,
    });
    const validationTrades = validationResult.trades;

    windows.push({
      index: fold + 1,
      trainingStartTime: training[0].openTime,
      trainingEndTime: training[training.length - 1].closeTime,
      validationStartTime: selectedCandles[validationStartIndex].openTime,
      validationEndTime: selectedCandles[validationEndIndex - 1].closeTime,
      training: {
        runId: trainingResult.runId,
        dataDigest: trainingResult.dataDigest,
        returnPct: trainingResult.metrics.totalReturnPct,
        maxDrawdownPct: trainingResult.metrics.maxDrawdownPct,
        totalTrades: trainingResult.metrics.totalTrades,
        winRatePct: trainingResult.metrics.winRatePct,
      },
      validation: {
        runId: validationResult.runId,
        dataDigest: validationResult.dataDigest,
        returnPct: validationResult.metrics.totalReturnPct,
        netProfit: validationResult.metrics.netProfit,
        maxDrawdownPct: validationResult.metrics.maxDrawdownPct,
        totalTrades: validationResult.metrics.totalTrades,
        winningTrades: validationResult.metrics.winningTrades,
        losingTrades: validationResult.metrics.losingTrades,
        winRatePct: validationResult.metrics.winRatePct,
        netWinningTradePnl: validationTrades.reduce((sum, trade) => sum + Math.max(0, trade.netPnl), 0),
        netLosingTradePnl: validationTrades.reduce((sum, trade) => sum + Math.max(0, -trade.netPnl), 0),
        firstTradeEntryTime: validationTrades.length
          ? Math.min(...validationTrades.map(trade => trade.entryTime)) : null,
        lastTradeExitTime: validationTrades.length
          ? Math.max(...validationTrades.map(trade => trade.exitTime)) : null,
        ...foldRiskMetrics(
          validationResult.equityCurve,
          config.interval,
          validationResult.metrics.totalReturnPct,
          validationResult.metrics.maxDrawdownPct,
        ),
      },
    });
  }

  const trainingReturns = windows.map(window => window.training.returnPct);
  const validationReturns = windows.map(window => window.validation.returnPct);
  const positiveValidationWindows = windows.filter(window => window.validation.returnPct > 0).length;
  const totalValidationTrades = windows.reduce((sum, window) => sum + window.validation.totalTrades, 0);
  const totalWinningTrades = windows.reduce((sum, window) => sum + window.validation.winningTrades, 0);
  const totalPositivePnl = windows.reduce((sum, window) => sum + window.validation.netWinningTradePnl, 0);
  const totalNegativePnl = windows.reduce((sum, window) => sum + window.validation.netLosingTradePnl, 0);

  const dataDigest = createHash("sha256").update(JSON.stringify(selectedCandles)).digest("hex");
  const runId = createHash("sha256").update(JSON.stringify({
    symbol: config.symbol,
    interval: config.interval,
    config,
    dataDigest,
    windowRunIds: windows.map(window => ({
      training: window.training.runId,
      validation: window.validation.runId,
    })),
  })).digest("hex").slice(0, 24);
  const averageTrainingReturnPct = mean(trainingReturns);
  const averageValidationReturnPct = mean(validationReturns);

  return {
    runId,
    dataDigest,
    symbol: config.symbol,
    interval: config.interval,
    strategy: "ema_crossover",
    candlesProcessed: requiredCandles,
    windows,
    metrics: {
      windowCount,
      averageTrainingReturnPct,
      averageValidationReturnPct,
      medianValidationReturnPct: median(validationReturns),
      validationReturnStdDevPct: standardDeviation(validationReturns),
      validationMinusTrainingReturnPct: averageValidationReturnPct - averageTrainingReturnPct,
      positiveValidationWindows,
      positiveValidationWindowPct: positiveValidationWindows / windowCount * 100,
      worstValidationDrawdownPct: Math.max(...windows.map(window => window.validation.maxDrawdownPct)),
      totalValidationTrades,
      validationWinRatePct: totalValidationTrades > 0
        ? totalWinningTrades / totalValidationTrades * 100 : 0,
      validationProfitFactor: totalNegativePnl === 0
        ? (totalPositivePnl > 0 ? null : 0)
        : totalPositivePnl / totalNegativePnl,
      riskAdjustedFoldCount: windows.filter(window => window.validation.sharpeRatio !== null).length,
      averageValidationSharpe: aggregateFoldMetric(windows.map(window => window.validation.sharpeRatio), "average"),
      medianValidationSharpe: aggregateFoldMetric(windows.map(window => window.validation.sharpeRatio), "median"),
      worstValidationSharpe: aggregateFoldMetric(windows.map(window => window.validation.sharpeRatio), "worst"),
      validationSharpeStdDev: aggregateFoldMetric(windows.map(window => window.validation.sharpeRatio), "stddev"),
      averageValidationSortino: aggregateFoldMetric(windows.map(window => window.validation.sortinoRatio), "average"),
      medianValidationSortino: aggregateFoldMetric(windows.map(window => window.validation.sortinoRatio), "median"),
      worstValidationSortino: aggregateFoldMetric(windows.map(window => window.validation.sortinoRatio), "worst"),
      validationSortinoStdDev: aggregateFoldMetric(windows.map(window => window.validation.sortinoRatio), "stddev"),
    },
    assumptions: [
      "Each training window is scored in-sample for comparison; it does not optimize or modify strategy parameters.",
      "Out-of-sample validation starts with a fresh virtual account and no open training positions.",
      "Training candles are used only for indicator warm-up and the last completed-candle signal; fills occur no earlier than the first validation candle open.",
      "Validation windows never overlap. Later rolling training windows may include earlier validation candles only after those candles have become historical.",
      "Each window resets to the configured starting capital; aggregate returns are descriptive per-window statistics, not a compounded portfolio simulation.",
      "The existing EMA crossover, fees, adverse slippage, stop-first OHLC handling and 1x notional cap are reused unchanged.",
      "Per-fold annualized volatility, Sharpe (0% risk-free rate) and Sortino (0% target) use timestamped marked-to-market validation equity returns and the same interval annualization as Strategy Benchmark; at least 30 valid interval returns are required.",
      "Undefined Sharpe/Sortino denominators and insufficient fold coverage remain unavailable; aggregate fold statistics require at least two valid folds and exclude unavailable values rather than treating them as zero.",
      "Risk-adjusted fold dispersion is descriptive only. Folds are independent virtual accounts and their equity curves are never concatenated.",
      "No parameter search, strategy selection, leverage, exchange orders, PAPER orders or LIVE execution are performed.",
    ],
    executionEligible: false,
  };
}
