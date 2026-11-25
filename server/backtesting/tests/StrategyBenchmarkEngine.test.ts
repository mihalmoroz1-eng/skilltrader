import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { runBacktest } from "../core/BacktestEngine";
import { runStrategyBenchmark, StrategyBenchmarkInputError } from "../core/StrategyBenchmarkEngine";

function series(closes: number[]): MarketCandle[] {
  const start = 1_700_000_000_000;
  return closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    return {
      openTime: start + index * 60_000,
      closeTime: start + index * 60_000 + 59_999,
      open: String(previous),
      high: String(Math.max(close, previous) + 0.6),
      low: String(Math.min(close, previous) - 0.6),
      close: String(close),
      volume: "100",
      quoteVolume: String(close * 100),
      tradeCount: 10,
    };
  });
}
const config = {
  symbol: "BTCUSDT",
  interval: "1m" as const,
  startingCapital: 10_000,
  riskBps: 50,
  stopLossBps: 200,
  takeProfitBps: 400,
  feeBps: 5,
  slippageBps: 5,
  fastEmaPeriod: 3,
  slowEmaPeriod: 8,
  allowShort: false,
};

describe("strategy benchmark engine", () => {
  it("is deterministic, digest-bound and research-only", () => {
    const candles = series([100, 101, 103, 102, 100, 98, 99, 102, 105, 108, 110, 112, 109, 106, 104, 107, 111, 114, 117, 120, 118, 115]);
    const first = runStrategyBenchmark(candles, config);
    const second = runStrategyBenchmark(candles, config);
    expect(first).toEqual(second);
    expect(first.executionEligible).toBe(false);
    expect(first.dataDigest).toHaveLength(64);
    expect(first.runId).toHaveLength(24);
    expect(first.strategy).toBe("ema_crossover");
  });

  it("uses the same historical data and active evaluation period for all tracks", () => {
    const candles = series([100, 101, 103, 102, 100, 98, 99, 102, 105, 108, 110, 112, 109, 106, 104, 107, 111, 114, 117, 120, 118, 115]);
    const result = runStrategyBenchmark(candles, config);
    const firstActiveIndex = config.slowEmaPeriod + 1;
    expect(result.candlesProcessed).toBe(candles.length);
    expect(result.benchmarks.buyAndHoldOneX.entryTime).toBe(candles[firstActiveIndex].openTime);
    expect(result.benchmarks.buyAndHoldRiskMatched.entryTime).toBe(candles[firstActiveIndex].openTime);
    expect(result.benchmarks.buyAndHoldOneX.exitTime).toBe(candles.at(-1)?.closeTime);
    expect(result.benchmarks.buyAndHoldOneX.totalTrades).toBe(1);
    expect(result.benchmarks.cashControl.totalTrades).toBe(0);
  });

  it("provides both fully invested and initial-risk-matched Buy & Hold benchmarks", () => {
    const result = runStrategyBenchmark(series([100, 101, 103, 102, 100, 98, 99, 102, 105, 108, 110, 112, 109, 106, 104, 107, 111, 114, 117, 120, 118, 115]), config);
    expect(result.benchmarks.buyAndHoldOneX.exposureFraction).toBe(1);
    expect(result.benchmarks.buyAndHoldRiskMatched.exposureFraction).toBe(0.25);
    expect(result.benchmarks.buyAndHoldOneX.exposureFraction)
      .toBeGreaterThan(result.benchmarks.buyAndHoldRiskMatched.exposureFraction!);
    expect(result.benchmarks.cashControl.totalReturnPct).toBe(0);
  });

  it("matches the canonical EMA backtest metrics exactly", () => {
    const candles = series([100, 101, 103, 102, 100, 98, 99, 102, 105, 108, 110, 112, 109, 106, 104, 107, 111, 114, 117, 120, 118, 115]);
    const result = runStrategyBenchmark(candles, config);
    const base = runBacktest(candles, config);
    expect(result.strategyRunId).toBe(base.runId);
    expect(result.strategyMetrics.totalReturnPct).toBe(base.metrics.totalReturnPct);
    expect(result.strategyMetrics.maxDrawdownPct).toBe(base.metrics.maxDrawdownPct);
    expect(result.strategyMetrics.totalTrades).toBe(base.metrics.totalTrades);
    expect(result.strategyMetrics.feesPaid).toBe(base.metrics.feesPaid);
  });

  it("charges Buy & Hold entry and exit fees and adverse slippage", () => {
    const candles = series([100, 101, 103, 102, 100, 98, 99, 102, 105, 108, 110, 112, 109, 106, 104, 107, 111, 114, 117, 120, 118, 115]);
    const free = runStrategyBenchmark(candles, { ...config, feeBps: 0, slippageBps: 0 });
    const costly = runStrategyBenchmark(candles, config);
    expect(costly.benchmarks.buyAndHoldOneX.feesPaid).toBeGreaterThan(0);
    expect(costly.benchmarks.buyAndHoldOneX.totalReturnPct)
      .toBeLessThan(free.benchmarks.buyAndHoldOneX.totalReturnPct);
    expect(costly.benchmarks.buyAndHoldRiskMatched.feesPaid).toBeGreaterThan(0);
  });

  it("reports excess return and drawdown differences in percentage points", () => {
    const result = runStrategyBenchmark(series([100, 101, 103, 102, 100, 98, 99, 102, 105, 108, 110, 112, 109, 106, 104, 107, 111, 114, 117, 120, 118, 115]), config);
    expect(result.comparison.excessReturnVsBuyAndHoldOneXPctPoints).toBe(
      result.strategyMetrics.totalReturnPct - result.benchmarks.buyAndHoldOneX.totalReturnPct,
    );
    expect(result.comparison.excessReturnVsRiskMatchedPctPoints).toBe(
      result.strategyMetrics.totalReturnPct - result.benchmarks.buyAndHoldRiskMatched.totalReturnPct,
    );
    expect(result.comparison.drawdownDifferenceVsBuyAndHoldOneXPctPoints).toBe(
      result.strategyMetrics.maxDrawdownPct - result.benchmarks.buyAndHoldOneX.maxDrawdownPct,
    );
  });

  it("rejects historical gaps and insufficient EMA warm-up", () => {
    const candles = series([100, 101, 103, 102, 100, 98, 99, 102, 105, 108, 110, 112, 109, 106, 104, 107, 111, 114, 117, 120, 118, 115]);
    const gap = [...candles];
    gap.splice(10, 1);
    expect(() => runStrategyBenchmark(gap, config)).toThrow(/gap/);
    expect(() => runStrategyBenchmark(candles.slice(0, 8), config)).toThrow();
  });

  it("rejects an oversized candle series before running multiple models", () => {
    expect(() => runStrategyBenchmark(new Array(50_001), config))
      .toThrow(StrategyBenchmarkInputError);
  });
});
