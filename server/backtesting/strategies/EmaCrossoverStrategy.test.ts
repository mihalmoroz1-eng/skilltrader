import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { emaCrossoverStrategy } from "./EmaCrossoverStrategy";

function series(closes: number[]): MarketCandle[] {
  const start = 1_700_000_000_000;
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    return {
      openTime: start + index * 60_000,
      closeTime: start + index * 60_000 + 59_999,
      open: String(open),
      high: String(Math.max(open, close) + 0.5),
      low: String(Math.min(open, close) - 0.5),
      close: String(close),
      volume: "100",
      quoteVolume: String(close * 100),
      tradeCount: 10,
    };
  });
}

describe("EMA crossover strategy adapter", () => {
  const config = { fastEmaPeriod: 2, slowEmaPeriod: 3 };

  it("declares its indicator warm-up requirement", () => {
    expect(emaCrossoverStrategy.id).toBe("ema_crossover");
    expect(emaCrossoverStrategy.minimumHistory(config)).toBe(5);
  });

  it("does not emit signals before both EMA series are valid", () => {
    const provider = emaCrossoverStrategy.createSignalProvider(series([10, 10, 10, 12, 14, 16]), config);
    expect(provider.signalAt(0)).toBeNull();
    expect(provider.signalAt(1)).toBeNull();
    expect(provider.signalAt(2)).toBeNull();
  });

  it("uses only the indexed closed candle and earlier history", () => {
    const candles = series([10, 10, 10, 12, 14, 16, 18, 20, 18, 16, 14, 12]);
    const changedFuture = [...candles];
    for (let index = 7; index < changedFuture.length; index += 1) {
      changedFuture[index] = {
        ...changedFuture[index],
        open: "1000",
        high: "1001",
        low: "999",
        close: "1000",
      };
    }
    const originalProvider = emaCrossoverStrategy.createSignalProvider(candles, config);
    const changedProvider = emaCrossoverStrategy.createSignalProvider(changedFuture, config);
    expect(changedProvider.signalAt(6)).toBe(originalProvider.signalAt(6));
  });

  it("returns no signal for an index outside the candle series", () => {
    const provider = emaCrossoverStrategy.createSignalProvider(series([10, 10, 10, 12, 14]), config);
    expect(provider.signalAt(-1)).toBeNull();
    expect(provider.signalAt(5)).toBeNull();
  });
});
