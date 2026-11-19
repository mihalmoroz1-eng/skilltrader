import { describe, expect, it } from "vitest";
import { buildCandles, simulateScenarios } from "../client/src/lib/simulation";

describe("synthetic market simulation", () => {
  it("creates reproducible OHLC candles for a fixed seed", () => {
    const first = buildCandles(2354.2, 64, 17);
    const second = buildCandles(2354.2, 64, 17);

    expect(first).toEqual(second);
    expect(first).toHaveLength(64);
    expect(first.every((candle) => candle.high >= Math.max(candle.open, candle.close))).toBe(true);
    expect(first.every((candle) => candle.low <= Math.min(candle.open, candle.close))).toBe(true);
  });

  it("returns a probability distribution and sample paths for the requested trial count", () => {
    const result = simulateScenarios(2354.2, 2346, 2370.5, "long", 1_000, 97, 42);
    const probabilitySum = result.targetProbability + result.stopProbability + result.otherProbability;

    expect(result.trials).toBe(1_000);
    expect(result.trajectories).toHaveLength(28);
    expect(result.trajectories.every((path) => path.length > 0)).toBe(true);
    expect(result.trajectories[0]).toHaveLength(43);
    expect(result.lowerBand).toHaveLength(43);
    expect(result.median).toHaveLength(43);
    expect(result.upperBand).toHaveLength(43);
    expect(probabilitySum).toBeCloseTo(100, 1);
    expect(result.lowerBand.every((value, index) => value <= result.upperBand[index])).toBe(true);
  });
});
