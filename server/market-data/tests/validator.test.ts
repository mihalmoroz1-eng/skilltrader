import { describe, expect, it } from "vitest";
import { validateCandles, MarketDataValidationError } from "../core/MarketDataValidator";
import type { MarketCandle } from "../core/MarketDataTypes";

const candle = (openTime: number, overrides: Partial<MarketCandle> = {}): MarketCandle => ({
  openTime,
  closeTime: openTime + 59_999,
  open: 100,
  high: 105,
  low: 98,
  close: 103,
  volume: 10,
  quoteVolume: 1_020,
  tradeCount: 4,
  ...overrides,
});

describe("market candle validator", () => {
  it("accepts valid ascending OHLC candles", () => {
    expect(() => validateCandles([candle(1_000), candle(61_000)])).not.toThrow();
  });

  it("rejects empty input, duplicate timestamps and out-of-order candles", () => {
    expect(() => validateCandles([])).toThrow(MarketDataValidationError);
    expect(() => validateCandles([candle(1_000), candle(1_000)])).toThrow(/duplicated or out of order/);
    expect(() => validateCandles([candle(61_000), candle(1_000)])).toThrow(/duplicated or out of order/);
  });

  it("rejects impossible OHLC values and negative volume", () => {
    expect(() => validateCandles([candle(1_000, { high: 99 })])).toThrow(/high is below/);
    expect(() => validateCandles([candle(1_000, { volume: -1 })])).toThrow(/cannot be negative/);
  });

  it("rejects non-finite and non-positive prices", () => {
    expect(() => validateCandles([candle(1_000, { close: Number.NaN })])).toThrow(/must be finite/);
    expect(() => validateCandles([candle(1_000, { open: 0 })])).toThrow(/prices must be positive/);
  });
});
