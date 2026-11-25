import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import {
  aggregateWalkForwardRegimeAdaptive,
  analyzeWalkForwardRegimeAdaptive,
} from "../core/WalkForwardRegimeAdaptiveAnalytics";

function makeCandles(count: number): MarketCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 * Math.pow(1.001, index);
    const close = 100 * Math.pow(1.001, index + 1);
    const openTime = index * 3_600_000;
    return {
      openTime,
      closeTime: openTime + 3_600_000 - 1,
      open: open.toFixed(8),
      high: (close * 1.0005).toFixed(8),
      low: (open * 0.9995).toFixed(8),
      close: close.toFixed(8),
      volume: "100",
      quoteVolume: "10000",
      tradeCount: 10,
    };
  });
}

const config = {
  interval: "1h" as const,
  lookback: 10,
  trendThresholdBps: 50,
  rangeThresholdBps: 20,
  highVolatilityThresholdBps: 500,
};

function analyze(foldIndex: number, strategyStepReturn: number) {
  const candles = makeCandles(15);
  return analyzeWalkForwardRegimeAdaptive(
    candles,
    11,
    [
      { time: candles[10].closeTime, equity: 1_000 },
      { time: candles[11].closeTime, equity: 1_000 * (1 + strategyStepReturn) },
      { time: candles[12].closeTime, equity: 1_000 * (1 + strategyStepReturn) ** 2 },
    ],
    foldIndex,
    config,
  );
}

describe("Walk-forward regime adaptive analytics", () => {
  it("compares OOS strategy returns with gross asset price returns by causal regime", () => {
    const result = analyze(1, 0.02);
    expect(result.status).toBe("ready");
    expect(result.benchmark).toBe("buy_and_hold_gross_price_return");
    const uptrend = result.buckets.find(item => item.regime === "uptrend")!;
    expect(uptrend.observations).toBe(2);
    expect(uptrend.foldResults).toHaveLength(1);
    expect(uptrend.foldResults[0].strategyReturnPct).toBeCloseTo(4.04, 2);
    expect(uptrend.foldResults[0].buyAndHoldGrossReturnPct).toBeGreaterThan(0);
    expect(uptrend.foldResults[0].excessReturnPctPoints).toBeGreaterThan(0);
  });

  it("aggregates independent fold outcomes without pooling fold return paths", () => {
    const result = aggregateWalkForwardRegimeAdaptive([
      analyze(1, 0.02),
      analyze(2, 0.005),
    ]);
    expect(result.status).toBe("ready");
    const uptrend = result.buckets.find(item => item.regime === "uptrend")!;
    expect(uptrend.foldsObserved).toBe(2);
    expect(uptrend.foldCoveragePct).toBe(100);
    expect(uptrend.excessPositiveFoldSharePct).toBe(100);
    expect(uptrend.medianExcessReturnPctPoints).not.toBeNull();
    expect(uptrend.foldResults.map(item => item.index)).toEqual([1, 2]);
  });

  it("withholds cross-fold comparisons when fewer than two folds are available", () => {
    const result = aggregateWalkForwardRegimeAdaptive([analyze(1, 0.01)]);
    const uptrend = result.buckets.find(item => item.regime === "uptrend")!;
    expect(result.status).toBe("insufficient_folds");
    expect(uptrend.excessPositiveFoldSharePct).toBeNull();
    expect(uptrend.medianExcessReturnPctPoints).toBeNull();
  });

  it("keeps unavailable excess-return extrema null when percentage conversion overflows", () => {
    const candles = makeCandles(15);
    const result = analyzeWalkForwardRegimeAdaptive(
      candles,
      11,
      [
        { time: candles[10].openTime, equity: 1 },
        { time: candles[11].closeTime, equity: 1e307 },
      ],
      1,
      config,
    );
    const populated = result.buckets.filter(item => item.observations > 0);
    expect(populated).toHaveLength(1);
    expect(populated[0].foldResults[0].strategyReturnPct).toBeNull();
    expect(populated[0].foldResults[0].excessReturnPctPoints).toBeNull();
    expect(populated[0].worstExcessReturnPctPoints).toBeNull();
  });

  it("rejects misaligned equity timestamps rather than silently assigning returns", () => {
    const candles = makeCandles(15);
    expect(() => analyzeWalkForwardRegimeAdaptive(
      candles,
      11,
      [
        { time: candles[10].closeTime, equity: 1_000 },
        { time: candles[11].closeTime + 1, equity: 1_010 },
      ],
      1,
      config,
    )).toThrow(/not aligned/);
  });
});
