import { describe, expect, it } from "vitest";
import { robustnessRequestSchema } from "@shared/backtest";

const base = {
  symbol: "BTCUSDT",
  interval: "1h",
  startTime: 1_700_000_000_000,
  endTime: 1_700_086_400_000,
  startingCapital: 10_000,
  riskBps: 50,
  stopLossBps: 200,
  takeProfitBps: 400,
  feeBps: 5,
  slippageBps: 5,
  fastEmaPeriod: 20,
  slowEmaPeriod: 50,
  allowShort: false,
};

describe("strategy robustness request schema", () => {
  it("accepts a bounded, normalized request", () => {
    const parsed = robustnessRequestSchema.parse({ ...base, symbol: "btcusdt" });
    expect(parsed.symbol).toBe("BTCUSDT");
    expect(parsed.regimeLookback).toBe(30);
    expect(parsed.trendThresholdBps).toBe(100);
    expect(parsed.rangeThresholdBps).toBe(50);
    expect(parsed.highVolatilityThresholdBps).toBe(200);
  });

  it("rejects cost inputs that make a 2x stress scenario exceed 100 bps", () => {
    expect(robustnessRequestSchema.safeParse({ ...base, feeBps: 51 }).success).toBe(false);
    expect(robustnessRequestSchema.safeParse({ ...base, slippageBps: 51 }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(robustnessRequestSchema.safeParse({ ...base, tuneForBestResult: true }).success).toBe(false);
  });
});
