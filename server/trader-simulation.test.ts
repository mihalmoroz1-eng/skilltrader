import { describe, expect, it } from "vitest";
import { CANDLE_INTERVALS_MS } from "../client/src/lib/candleTimer";
import { buildCandles, getSimulationInputKey, simulateScenarios } from "../client/src/lib/simulation";

const fixedNow = Date.UTC(2026, 10, 20, 12, 7);

describe("synthetic market simulation", () => {
  it("marks a Monte Carlo result stale when any simulation input changes", () => {
    const previous = { entry: 100, stop: 98, target: 104, side: "long" as const, trials: 10_000, seed: 31 };
    const key = getSimulationInputKey(previous);

    expect(getSimulationInputKey({ ...previous })).toBe(key);
    expect(getSimulationInputKey({ ...previous, entry: 101 })).not.toBe(key);
    expect(getSimulationInputKey({ ...previous, stop: 97 })).not.toBe(key);
    expect(getSimulationInputKey({ ...previous, target: 105 })).not.toBe(key);
    expect(getSimulationInputKey({ ...previous, seed: 32 })).not.toBe(key);
  });

  it("creates reproducible OHLC candles for a fixed seed, period and time", () => {
    const first = buildCandles(2354.2, 64, 17, "15м", fixedNow);
    const second = buildCandles(2354.2, 64, 17, "15м", fixedNow);

    expect(first).toEqual(second);
    expect(first).toHaveLength(64);
    expect(first.every((candle) => candle.high >= Math.max(candle.open, candle.close))).toBe(true);
    expect(first.every((candle) => candle.low <= Math.min(candle.open, candle.close))).toBe(true);
  });

  it.each([
    ["15м", "12:00Z"],
    ["1ч", "12:00Z"],
    ["4ч", "11-20 12:00Z"],
  ] as const)("aligns %s candles to their UTC boundary", (timeframe, expectedLabel) => {
    const intervalMs = CANDLE_INTERVALS_MS[timeframe];
    const candles = buildCandles(2354.2, 4, 17, timeframe, fixedNow);
    const latest = candles[candles.length - 1];

    expect(latest.timestamp).toBe(Math.floor(fixedNow / intervalMs) * intervalMs);
    expect(latest.time).toBe(expectedLabel);
    expect(candles.slice(1).every((candle, index) => candle.timestamp - candles[index].timestamp === intervalMs)).toBe(true);
  });

  it("scales the synthetic range with the square root of the selected duration", () => {
    const quarterHour = buildCandles(2354.2, 8, 17, "15м", fixedNow)[0];
    const oneHour = buildCandles(2354.2, 8, 17, "1ч", fixedNow)[0];
    const fourHours = buildCandles(2354.2, 8, 17, "4ч", fixedNow)[0];
    const range = (candle: typeof quarterHour) => candle.high - candle.low;

    expect(range(oneHour) / range(quarterHour)).toBeCloseTo(2, 5);
    expect(range(fourHours) / range(quarterHour)).toBeCloseTo(4, 5);
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
