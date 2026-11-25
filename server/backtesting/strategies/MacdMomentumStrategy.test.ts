import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { macdMomentumStrategy } from "./MacdMomentumStrategy";

function series(closes: number[]): MarketCandle[] {
  const start = 1_700_000_000_000;
  return closes.map((close, index) => ({
    openTime: start + index * 60_000,
    closeTime: start + index * 60_000 + 59_999,
    open: String(index === 0 ? close : closes[index - 1]),
    high: String(Math.max(close, index === 0 ? close : closes[index - 1]) + 0.5),
    low: String(Math.min(close, index === 0 ? close : closes[index - 1]) - 0.5),
    close: String(close),
    volume: "100",
    quoteVolume: String(close * 100),
    tradeCount: 10,
  }));
}

const config = { fastPeriod: 3, slowPeriod: 6, signalPeriod: 3 };
const closes = [
  ...Array.from({ length: 24 }, (_, index) => 120 - index * 2),
  ...Array.from({ length: 20 }, (_, index) => 72 + index * 3),
  ...Array.from({ length: 20 }, (_, index) => 129 - index * 3),
];

describe("MACD momentum strategy", () => {
  it("requires both MACD and signal-line warm-up plus next-open boundary", () => {
    expect(macdMomentumStrategy.minimumHistory(config)).toBe(10);
  });

  it("emits directional events only when MACD crosses its signal line", () => {
    const provider = macdMomentumStrategy.createSignalProvider(series(closes), config);
    const events = closes.map((_, index) => provider.signalAt(index))
      .filter((signal): signal is "LONG" | "SHORT" => signal === "LONG" || signal === "SHORT");
    expect(events).toContain("LONG");
    expect(events).toContain("SHORT");
  });

  it("does not allow future candles to alter an earlier signal", () => {
    const prefix = series(closes.slice(0, 35));
    const full = series(closes);
    const prefixProvider = macdMomentumStrategy.createSignalProvider(prefix, config);
    const fullProvider = macdMomentumStrategy.createSignalProvider(full, config);
    for (let index = 1; index < prefix.length; index += 1) {
      expect(fullProvider.signalAt(index)).toBe(prefixProvider.signalAt(index));
    }
  });

  it("returns no signal for invalid indexes", () => {
    const provider = macdMomentumStrategy.createSignalProvider(series(closes), config);
    expect(provider.signalAt(-1)).toBeNull();
    expect(provider.signalAt(1.5)).toBeNull();
    expect(provider.signalAt(closes.length)).toBeNull();
  });

  it("rejects invalid MACD periods", () => {
    expect(() => macdMomentumStrategy.minimumHistory({ ...config, fastPeriod: 6 })).toThrow(RangeError);
    expect(() => macdMomentumStrategy.createSignalProvider(
      series(closes), { ...config, signalPeriod: 1 },
    )).toThrow(RangeError);
  });
});
