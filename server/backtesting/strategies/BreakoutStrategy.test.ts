import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { breakoutStrategy } from "./BreakoutStrategy";

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

const config = { lookbackPeriod: 3, breakoutBufferBps: 10 };

describe("breakout strategy", () => {
  it("requires the prior range, a confirmation candle and next-open boundary", () => {
    expect(breakoutStrategy.minimumHistory(config)).toBe(5);
  });

  it("emits LONG only after a close clears the prior range plus buffer", () => {
    const provider = breakoutStrategy.createSignalProvider(series([10, 10, 10, 10, 12]), config);
    expect(provider.signalAt(3)).toBeNull();
    expect(provider.signalAt(4)).toBe("LONG");
  });

  it("emits SHORT only after a close breaks below the prior range plus buffer", () => {
    const provider = breakoutStrategy.createSignalProvider(series([12, 12, 12, 12, 10]), config);
    expect(provider.signalAt(4)).toBe("SHORT");
  });

  it("ignores wick-only breakouts and closes inside the buffered range", () => {
    const candles = series([10, 10, 10, 10, 10.4]);
    candles[4] = { ...candles[4], high: "15", low: "9", close: "10.4" };
    const provider = breakoutStrategy.createSignalProvider(candles, config);
    expect(provider.signalAt(4)).toBeNull();
  });

  it("does not allow future candles to alter an earlier signal", () => {
    const closes = [10, 10, 10, 10, 12, 12, 8, 8];
    const prefix = breakoutStrategy.createSignalProvider(series(closes.slice(0, 5)), config);
    const full = breakoutStrategy.createSignalProvider(series(closes), config);
    for (let index = 0; index < 5; index += 1) {
      expect(full.signalAt(index)).toBe(prefix.signalAt(index));
    }
  });

  it("returns no signal for invalid indexes and rejects invalid configuration", () => {
    const provider = breakoutStrategy.createSignalProvider(series([10, 10, 10, 10, 12]), config);
    expect(provider.signalAt(-1)).toBeNull();
    expect(provider.signalAt(1.5)).toBeNull();
    expect(provider.signalAt(5)).toBeNull();
    expect(() => breakoutStrategy.minimumHistory({ ...config, lookbackPeriod: 1 })).toThrow(RangeError);
    expect(() => breakoutStrategy.createSignalProvider(series([10, 10, 10]), {
      ...config, breakoutBufferBps: 501,
    })).toThrow(RangeError);
  });
});
