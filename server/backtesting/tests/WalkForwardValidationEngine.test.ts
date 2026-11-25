import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { runWalkForwardValidation, WalkForwardInputError } from "../core/WalkForwardValidationEngine";

function series(closes: number[]): MarketCandle[] {
  const start = 1_700_000_000_000;
  return closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    return {
      openTime: start + index * 60_000,
      closeTime: start + index * 60_000 + 59_999,
      open: String(previous),
      high: String(Math.max(close, previous) + 0.5),
      low: String(Math.min(close, previous) - 0.5),
      close: String(close),
      volume: "100",
      quoteVolume: String(close * 100),
      tradeCount: 10,
    };
  });
}

const closes = [
  100, 100, 100, 120, 140, 160, 180, 150, 120, 100,
  90, 110, 130, 150, 170, 140, 110, 90, 100, 120,
  140, 160, 180, 150, 120, 90, 110, 130, 150, 170,
  140, 110, 90, 100, 120, 140, 160, 180,
];
const config = {
  symbol: "BTCUSDT",
  interval: "1m" as const,
  startingCapital: 10_000,
  riskBps: 50,
  stopLossBps: 200,
  takeProfitBps: 400,
  feeBps: 0,
  slippageBps: 0,
  fastEmaPeriod: 2,
  slowEmaPeriod: 3,
  allowShort: false,
  trainingCandles: 8,
  validationCandles: 10,
  stepCandles: 10,
  windowCount: 2,
};

describe("walk-forward validation engine", () => {
  it("is deterministic and never produces execution-eligible output", () => {
    const candles = series(closes);
    const first = runWalkForwardValidation(candles, config);
    const second = runWalkForwardValidation(candles, config);
    expect(first).toEqual(second);
    expect(first.executionEligible).toBe(false);
    expect(first.strategy).toBe("ema_crossover");
    expect(first.windows).toHaveLength(2);
  });

  it("scores only the out-of-sample bars while using prior training bars as warm-up", () => {
    const candles = series(closes);
    const result = runWalkForwardValidation(candles, config);
    const selected = candles.slice(candles.length - 28);
    expect(result.windows[0].validationStartTime).toBe(selected[8].openTime);
    expect(result.windows[0].validationEndTime).toBe(selected[17].closeTime);
    expect(result.windows[0].validation.runId).not.toBe(result.windows[0].training.runId);
    expect(result.windows[0].validation.firstTradeEntryTime === null ||
      result.windows[0].validation.firstTradeEntryTime >= selected[8].openTime).toBe(true);
    expect(result.windows[0].validation.lastTradeExitTime === null ||
      result.windows[0].validation.lastTradeExitTime >= selected[8].openTime).toBe(true);
    expect(result.windows[0].validation.totalTrades).toBeGreaterThanOrEqual(0);
    expect(result.windows[0].validation.returnPct).toEqual(expect.any(Number));
  });

  it("keeps out-of-sample validation windows chronological and non-overlapping", () => {
    const candles = series(closes);
    const result = runWalkForwardValidation(candles, config);
    expect(result.windows[0].validationEndTime).toBeLessThan(result.windows[1].validationStartTime);
    const selected = candles.slice(candles.length - 28);
    expect(result.windows[1].validationStartTime).toBe(selected[18].openTime);
  });

  it("uses the latest required history and binds the run id to its candle digest", () => {
    const candles = series(closes);
    const first = runWalkForwardValidation(candles, config);
    const changed = [...candles];
    changed[changed.length - 1] = { ...changed[changed.length - 1], close: "171" };
    const second = runWalkForwardValidation(changed, config);
    expect(first.dataDigest).not.toBe(second.dataDigest);
    expect(first.runId).not.toBe(second.runId);
  });

  it("rejects overlapping validation folds", () => {
    expect(() => runWalkForwardValidation(series(closes), {
      ...config, stepCandles: 9,
    })).toThrow(WalkForwardInputError);
  });

  it("rejects training windows that do not cover indicator warm-up", () => {
    expect(() => runWalkForwardValidation(series(closes), {
      ...config, trainingCandles: 4,
    })).toThrow(/EMA warm-up/);
  });

  it("rejects incomplete historical ranges", () => {
    expect(() => runWalkForwardValidation(series(closes.slice(0, 20)), config))
      .toThrow(/Insufficient history/);
  });

  it("rejects gaps in the full selected sequence, including skipped step candles", () => {
    const candles = series(closes);
    candles.splice(19, 1);
    expect(() => runWalkForwardValidation(candles, config)).toThrow(/gap/);
  });

  it("reports aggregate validation metrics from out-of-sample windows only", () => {
    const result = runWalkForwardValidation(series(closes), config);
    expect(result.metrics.windowCount).toBe(2);
    expect(result.metrics.positiveValidationWindowPct).toBeGreaterThanOrEqual(0);
    expect(result.metrics.positiveValidationWindowPct).toBeLessThanOrEqual(100);
    expect(result.metrics.totalValidationTrades).toBe(
      result.windows.reduce((sum, window) => sum + window.validation.totalTrades, 0),
    );
    expect(result.metrics.validationMinusTrainingReturnPct).toEqual(expect.any(Number));
  });
});
