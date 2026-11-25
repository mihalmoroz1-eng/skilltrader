import { describe, expect, it } from "vitest";
import { runBacktest } from "../core/BacktestEngine";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import {
  runStrategyRobustness,
  StrategyRobustnessInputError,
} from "../core/StrategyRobustnessEngine";

function series(count: number): MarketCandle[] {
  const start = 1_700_000_000_000;
  const closes = Array.from({ length: count }, (_, index) =>
    100 + index * 0.025 + Math.sin(index / 4) * 3 + Math.sin(index / 13) * 1.5,
  );
  return closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    return {
      openTime: start + index * 60_000,
      closeTime: start + index * 60_000 + 59_999,
      open: String(previous),
      high: String(Math.max(close, previous) + 0.35),
      low: String(Math.min(close, previous) - 0.35),
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
  allowShort: true,
  regimeLookback: 5,
  trendThresholdBps: 40,
  volatilityThresholdBps: 10,
};

describe("strategy robustness engine", () => {
  it("is deterministic and never marks research results execution eligible", () => {
    const candles = series(240);
    const first = runStrategyRobustness(candles, config);
    const second = runStrategyRobustness(candles, config);
    expect(first).toEqual(second);
    expect(first.executionEligible).toBe(false);
    expect(first.strategy).toBe("ema_crossover");
    expect(first.dataDigest).toHaveLength(64);
    expect(first.runId).toHaveLength(24);
  });

  it("runs baseline, 1.5x and 2x adverse-cost scenarios", () => {
    const result = runStrategyRobustness(series(240), config);
    expect(result.costScenarios.map(item => item.id)).toEqual(["baseline", "cost_1_5x", "cost_2x"]);
    expect(result.costScenarios.map(item => item.multiplier)).toEqual([1, 1.5, 2]);
    expect(result.costScenarios[0].feeBps).toBe(config.feeBps);
    expect(result.costScenarios[2].feeBps).toBe(config.feeBps * 2);
    expect(result.metrics.worstCostStressReturnPct).toBe(
      Math.min(...result.costScenarios.map(item => item.returnPct)),
    );
  });

  it("tests a bounded set of neighboring EMA parameters without selecting a winner", () => {
    const result = runStrategyRobustness(series(240), config);
    expect(result.parameterScenarios.length).toBeGreaterThanOrEqual(2);
    expect(result.parameterScenarios.length).toBeLessThanOrEqual(8);
    expect(new Set(result.parameterScenarios.map(item => item.id)).size)
      .toBe(result.parameterScenarios.length);
    expect(result.parameterScenarios.every(item =>
      item.fastEmaPeriod < item.slowEmaPeriod &&
      item.returnDeltaFromBaselinePct === item.returnPct - result.baseline.returnPct,
    )).toBe(true);
    expect(result.metrics.minimumParameterReturnPct).toBe(
      Math.min(...result.parameterScenarios.map(item => item.returnPct)),
    );
    expect(result.metrics.maximumParameterReturnPct).toBe(
      Math.max(...result.parameterScenarios.map(item => item.returnPct)),
    );
  });

  it("attributes every baseline trade to a trailing, pre-entry market regime", () => {
    const result = runStrategyRobustness(series(240), config);
    const attributedTrades = result.regimes.reduce((sum, regime) => sum + regime.tradeCount, 0);
    expect(attributedTrades).toBe(result.baseline.totalTrades);
    expect(result.regimes).toHaveLength(7);
    expect(result.metrics.regimeCoveragePct).toBeGreaterThanOrEqual(0);
    expect(result.metrics.regimeCoveragePct).toBeLessThanOrEqual(100);
    expect(result.regimes.every(regime => regime.tradeCount >= 0 && Number.isFinite(regime.netPnl))).toBe(true);
  });

  it("keeps the baseline metrics equal to the existing backtesting engine", () => {
    const candles = series(240);
    const base = runBacktest(candles, {
      symbol: config.symbol,
      interval: config.interval,
      startingCapital: config.startingCapital,
      riskBps: config.riskBps,
      stopLossBps: config.stopLossBps,
      takeProfitBps: config.takeProfitBps,
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
      fastEmaPeriod: config.fastEmaPeriod,
      slowEmaPeriod: config.slowEmaPeriod,
      allowShort: config.allowShort,
    });
    const result = runStrategyRobustness(candles, config);
    expect(result.baseline.runId).toBe(base.runId);
    expect(result.baseline.returnPct).toBe(base.metrics.totalReturnPct);
    expect(result.baseline.maxDrawdownPct).toBe(base.metrics.maxDrawdownPct);
    expect(result.baseline.totalTrades).toBe(base.metrics.totalTrades);
  });

  it("rejects base costs that would exceed the supported 2x stress limits", () => {
    expect(() => runStrategyRobustness(series(240), { ...config, feeBps: 51 }))
      .toThrow(StrategyRobustnessInputError);
    expect(() => runStrategyRobustness(series(240), { ...config, slippageBps: 51 }))
      .toThrow(StrategyRobustnessInputError);
  });

  it("rejects invalid regime thresholds", () => {
    expect(() => runStrategyRobustness(series(240), { ...config, regimeLookback: 4 }))
      .toThrow(StrategyRobustnessInputError);
    expect(() => runStrategyRobustness(series(240), { ...config, volatilityThresholdBps: 0 }))
      .toThrow(StrategyRobustnessInputError);
  });

  it("rejects gaps in the historical series", () => {
    const candles = series(240);
    candles.splice(90, 1);
    expect(() => runStrategyRobustness(candles, config)).toThrow(/gap/);
  });
});
