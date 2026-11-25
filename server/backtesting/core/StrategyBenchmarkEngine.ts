import { createHash } from "node:crypto";
import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import {
  runBacktest,
  validateBacktestCandleSeries,
  type BacktestConfig,
  type BacktestResult,
} from "./BacktestEngine";

export type StrategyBenchmarkConfig = Omit<BacktestConfig, "evaluationStartIndex">;

export type BenchmarkTrackMetrics = {
  startingCapital: number;
  finalEquity: number;
  netProfit: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  feesPaid: number;
  totalTrades: number;
  exposureFraction: number | null;
  entryTime: number | null;
  exitTime: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  riskMetricObservations: number;
  annualizedVolatilityPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  returnToMaxDrawdown: number | null;
};

export type StrategyBenchmarkResult = {
  runId: string;
  dataDigest: string;
  symbol: string;
  interval: BacktestConfig["interval"];
  strategy: string;
  candlesProcessed: number;
  strategyRunId: string;
  strategyMetrics: BenchmarkTrackMetrics;
  benchmarks: {
    buyAndHoldOneX: BenchmarkTrackMetrics;
    buyAndHoldRiskMatched: BenchmarkTrackMetrics;
    cashControl: BenchmarkTrackMetrics;
  };
  comparison: {
    excessReturnVsBuyAndHoldOneXPctPoints: number;
    excessReturnVsRiskMatchedPctPoints: number;
    drawdownDifferenceVsBuyAndHoldOneXPctPoints: number;
    outperformedBuyAndHoldOneX: boolean;
    outperformedRiskMatchedBuyAndHold: boolean;
    outperformedCash: boolean;
  };
  assumptions: string[];
  executionEligible: false;
};

export class StrategyBenchmarkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyBenchmarkInputError";
  }
}

const MIN_RISK_OBSERVATIONS = 30;
const INTERVAL_MS: Partial<Record<MarketInterval, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};
function annualizationPeriods(interval: MarketInterval): number {
  return interval === "1M" ? 12 : 365.2425 * 86_400_000 / (INTERVAL_MS[interval] ?? 0);
}
function riskAdjustedMetrics(
  curve: Array<{ time: number; equity: number }>,
  interval: MarketInterval,
  totalReturnPct: number,
  maxDrawdownPct: number,
): Pick<BenchmarkTrackMetrics, "riskMetricObservations" | "annualizedVolatilityPct" | "sharpeRatio" | "sortinoRatio" | "returnToMaxDrawdown"> {
  const returns: number[] = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1].equity;
    const current = curve[index].equity;
    if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) {
      return { riskMetricObservations: returns.length, annualizedVolatilityPct: null, sharpeRatio: null, sortinoRatio: null, returnToMaxDrawdown: null };
    }
    returns.push(current / previous - 1);
  }
  const periods = annualizationPeriods(interval);
  if (returns.length < MIN_RISK_OBSERVATIONS || !Number.isFinite(periods) || periods <= 0) {
    return { riskMetricObservations: returns.length, annualizedVolatilityPct: null, sharpeRatio: null, sortinoRatio: null, returnToMaxDrawdown: maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : null };
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const volatility = Math.sqrt(variance);
  const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / returns.length);
  return {
    riskMetricObservations: returns.length,
    annualizedVolatilityPct: Number.isFinite(volatility) ? volatility * Math.sqrt(periods) * 100 : null,
    sharpeRatio: volatility > 0 ? mean / volatility * Math.sqrt(periods) : null,
    sortinoRatio: downside > 0 ? mean / downside * Math.sqrt(periods) : null,
    returnToMaxDrawdown: maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : null,
  };
}

function adverseBuyPrice(open: number, slippageRate: number): number {
  return open * (1 + slippageRate);
}

function adverseSellPrice(close: number, slippageRate: number): number {
  return close * (1 - slippageRate);
}

function summarizeStrategy(result: BacktestResult, interval: MarketInterval): BenchmarkTrackMetrics {
  return {
    startingCapital: result.metrics.startingCapital,
    finalEquity: result.metrics.finalEquity,
    netProfit: result.metrics.netProfit,
    totalReturnPct: result.metrics.totalReturnPct,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
    feesPaid: result.metrics.feesPaid,
    totalTrades: result.metrics.totalTrades,
    exposureFraction: null,
    entryTime: result.trades.length ? Math.min(...result.trades.map(trade => trade.entryTime)) : null,
    exitTime: result.trades.length ? Math.max(...result.trades.map(trade => trade.exitTime)) : null,
    entryPrice: null,
    exitPrice: null,
    ...riskAdjustedMetrics(result.equityCurve, interval, result.metrics.totalReturnPct, result.metrics.maxDrawdownPct),
  };
}

function simulateBuyAndHold(
  candles: MarketCandle[],
  config: StrategyBenchmarkConfig,
  exposureFraction: number,
  id: "buy_and_hold_1x" | "buy_and_hold_risk_matched",
  dataDigest: string,
): BenchmarkTrackMetrics & { runId: string } {
  const evaluationStartIndex = config.slowEmaPeriod + 1;
  const entryCandle = candles[evaluationStartIndex];
  const finalCandle = candles[candles.length - 1];
  if (!entryCandle || !finalCandle) {
    throw new StrategyBenchmarkInputError("Insufficient candles for the benchmark period");
  }

  const rawOpen = Number(entryCandle.open);
  const rawClose = Number(finalCandle.close);
  if (!Number.isFinite(rawOpen) || rawOpen <= 0 || !Number.isFinite(rawClose) || rawClose <= 0) {
    throw new StrategyBenchmarkInputError("Benchmark entry or exit price is invalid");
  }

  const feeRate = config.feeBps / 10_000;
  const slippageRate = config.slippageBps / 10_000;
  const notional = config.startingCapital * exposureFraction;
  const entryPrice = adverseBuyPrice(rawOpen, slippageRate);
  const quantity = notional / entryPrice;
  const entryFee = notional * feeRate;
  const exitPrice = adverseSellPrice(rawClose, slippageRate);
  const exitNotional = exitPrice * quantity;
  const exitFee = exitNotional * feeRate;
  const grossPnl = (exitPrice - entryPrice) * quantity;
  const finalEquity = config.startingCapital - entryFee + grossPnl - exitFee;

  let peakEquity = config.startingCapital;
  let maxDrawdownPct = 0;
  const equityCurve: Array<{ time: number; equity: number }> = [{ time: entryCandle.openTime, equity: config.startingCapital }];
  for (let index = evaluationStartIndex; index < candles.length; index += 1) {
    const close = Number(candles[index].close);
    if (!Number.isFinite(close) || close <= 0) {
      throw new StrategyBenchmarkInputError(`Benchmark candle ${index} has an invalid close price`);
    }
    const markedEquity = config.startingCapital - entryFee + (close - entryPrice) * quantity;
    equityCurve.push({ time: candles[index].closeTime, equity: markedEquity });
    peakEquity = Math.max(peakEquity, markedEquity);
    if (peakEquity > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - markedEquity) / peakEquity * 100);
    }
  }
  peakEquity = Math.max(peakEquity, config.startingCapital);
  if (peakEquity > 0) {
    maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - finalEquity) / peakEquity * 100);
  }

  const netProfit = finalEquity - config.startingCapital;
  const runId = createHash("sha256").update(JSON.stringify({
    id,
    config,
    dataDigest,
    exposureFraction,
    entryTime: entryCandle.openTime,
    exitTime: finalCandle.closeTime,
  })).digest("hex").slice(0, 24);

  return {
    runId,
    startingCapital: config.startingCapital,
    finalEquity,
    netProfit,
    totalReturnPct: netProfit / config.startingCapital * 100,
    maxDrawdownPct,
    feesPaid: entryFee + exitFee,
    totalTrades: 1,
    exposureFraction,
    entryTime: entryCandle.openTime,
    exitTime: finalCandle.closeTime,
    entryPrice,
    exitPrice,
    ...riskAdjustedMetrics(equityCurve.map((point, index) => index === equityCurve.length - 1 ? { ...point, equity: finalEquity } : point), config.interval, netProfit / config.startingCapital * 100, maxDrawdownPct),
  };
}

function cashControl(startingCapital: number): BenchmarkTrackMetrics {
  return {
    startingCapital,
    finalEquity: startingCapital,
    netProfit: 0,
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    feesPaid: 0,
    totalTrades: 0,
    exposureFraction: 0,
    entryTime: null,
    exitTime: null,
    entryPrice: null,
    exitPrice: null,
    riskMetricObservations: 0,
    annualizedVolatilityPct: null,
    sharpeRatio: null,
    sortinoRatio: null,
    returnToMaxDrawdown: null,
  };
}

export function runStrategyBenchmark(
  candles: MarketCandle[],
  config: StrategyBenchmarkConfig,
): StrategyBenchmarkResult {
  if (candles.length > 50_000) {
    throw new StrategyBenchmarkInputError("Strategy benchmark is limited to 50,000 historical candles");
  }

  // The canonical strategy engine validates strategy config, history length, closed candles and gaps.
  const strategyResult = runBacktest(candles, config);
  validateBacktestCandleSeries(candles, config.interval);

  const dataDigest = strategyResult.dataDigest;
  const buyAndHoldOneX = simulateBuyAndHold(candles, config, 1, "buy_and_hold_1x", dataDigest);
  const riskMatchedExposure = Math.min(1, config.riskBps / config.stopLossBps);
  const buyAndHoldRiskMatched = simulateBuyAndHold(
    candles, config, riskMatchedExposure, "buy_and_hold_risk_matched", dataDigest,
  );
  const strategyMetrics = summarizeStrategy(strategyResult, config.interval);
  const cash = cashControl(config.startingCapital);

  const runId = createHash("sha256").update(JSON.stringify({
    config,
    dataDigest,
    strategyRunId: strategyResult.runId,
    buyAndHoldOneXRunId: buyAndHoldOneX.runId,
    buyAndHoldRiskMatchedRunId: buyAndHoldRiskMatched.runId,
  })).digest("hex").slice(0, 24);

  return {
    runId,
    dataDigest,
    symbol: config.symbol,
    interval: config.interval,
    strategy: config.strategy ?? "ema_crossover",
    candlesProcessed: candles.length,
    strategyRunId: strategyResult.runId,
    strategyMetrics,
    benchmarks: {
      buyAndHoldOneX,
      buyAndHoldRiskMatched,
      cashControl: cash,
    },
    comparison: {
      excessReturnVsBuyAndHoldOneXPctPoints:
        strategyMetrics.totalReturnPct - buyAndHoldOneX.totalReturnPct,
      excessReturnVsRiskMatchedPctPoints:
        strategyMetrics.totalReturnPct - buyAndHoldRiskMatched.totalReturnPct,
      drawdownDifferenceVsBuyAndHoldOneXPctPoints:
        strategyMetrics.maxDrawdownPct - buyAndHoldOneX.maxDrawdownPct,
      outperformedBuyAndHoldOneX:
        strategyMetrics.totalReturnPct > buyAndHoldOneX.totalReturnPct,
      outperformedRiskMatchedBuyAndHold:
        strategyMetrics.totalReturnPct > buyAndHoldRiskMatched.totalReturnPct,
      outperformedCash: strategyMetrics.totalReturnPct > cash.totalReturnPct,
    },
    assumptions: [
      "EMA Crossover and all benchmarks use the same validated contiguous closed-candle series and the same active evaluation period, beginning at the first candle where the EMA engine may evaluate a completed-candle signal.",
      "Buy & Hold 1x invests the full starting notional at the first evaluation candle open and closes at the final candle close.",
      "Risk-matched Buy & Hold uses a fixed initial exposure fraction equal to min(1, riskBps / stopLossBps); this matches the EMA engine's initial target notional ratio, not its dynamic position-by-position exposure.",
      "Both Buy & Hold tracks apply adverse entry and exit slippage and charge fees on entry and exit. They do not use EMA stops, targets or reversal signals.",
      "Cash control holds the full starting capital without trades, fees or market exposure.",
      "Maximum drawdown is calculated from marked-to-market equity across candle closes and includes entry costs and final exit costs.",
      "Annualized volatility, Sharpe and Sortino are calculated from the timestamped marked equity curve with a 0% risk-free/target rate; at least 30 interval returns are required. These metrics are unavailable for shorter samples or zero variance.",
      "Return-to-maximum-drawdown is unavailable when maximum drawdown is zero; no undefined ratio is replaced with zero.",
      "The 1x Buy & Hold benchmark has greater initial market exposure than the EMA strategy when the configured per-trade risk ratio is below 100%; both comparisons are shown to make this difference explicit.",
      "All outputs are historical comparison only, executionEligible=false; no signals, PAPER orders, exchange orders or LIVE execution are created or authorized.",
    ],
    executionEligible: false,
  };
}
