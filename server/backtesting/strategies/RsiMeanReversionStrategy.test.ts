import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { rsiMeanReversionStrategy } from "./RsiMeanReversionStrategy";

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

const config = { rsiPeriod: 2, oversoldLevel: 30, overboughtLevel: 70 };

describe("RSI mean-reversion strategy", () => {
  it("defines a warm-up long enough to detect a crossing and execute next open", () => {
    expect(rsiMeanReversionStrategy.minimumHistory(config)).toBe(5);
  });

  it("emits long, exit, short and exit events at threshold crossings", () => {
    const candles = series([100, 90, 80, 90, 100, 110, 100, 90, 80, 70]);
    const provider = rsiMeanReversionStrategy.createSignalProvider(candles, config);
    expect(provider.signalAt(2)).toBeNull();
    expect(provider.signalAt(3)).toBe("LONG");
    expect(provider.signalAt(4)).toBe("EXIT");
    expect(provider.signalAt(5)).toBeNull();
    expect(provider.signalAt(6)).toBe("SHORT");
    expect(provider.signalAt(7)).toBe("EXIT");
  });

  it("does not let future candles alter an earlier signal", () => {
    const closes = [100, 90, 80, 90, 100, 110, 100, 90, 80, 70];
    const prefixProvider = rsiMeanReversionStrategy.createSignalProvider(series(closes.slice(0, 5)), config);
    const fullProvider = rsiMeanReversionStrategy.createSignalProvider(series(closes), config);
    expect(fullProvider.signalAt(3)).toBe(prefixProvider.signalAt(3));
  });

  it("returns no signal for invalid indexes", () => {
    const provider = rsiMeanReversionStrategy.createSignalProvider(series([100, 90, 80, 90, 100]), config);
    expect(provider.signalAt(-1)).toBeNull();
    expect(provider.signalAt(1.5)).toBeNull();
    expect(provider.signalAt(99)).toBeNull();
  });

  it("rejects invalid periods and threshold ranges", () => {
    expect(() => rsiMeanReversionStrategy.minimumHistory({ ...config, rsiPeriod: 1 })).toThrow(RangeError);
    expect(() => rsiMeanReversionStrategy.createSignalProvider(
      series([100, 90, 80, 90, 100]),
      { ...config, oversoldLevel: 60, overboughtLevel: 65 },
    )).toThrow(RangeError);
  });
});
