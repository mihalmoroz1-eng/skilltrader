import { describe, expect, it } from "vitest";
import { validateCandles, MarketDataValidationError } from "../core/MarketDataValidator";
import type { MarketCandle } from "../core/MarketDataTypes";

const candle = (openTime: number, overrides: Partial<MarketCandle> = {}): MarketCandle => ({
  openTime,
  closeTime: openTime + 59_999,
  open: "100",
  high: "105",
  low: "98",
  close: "103",
  volume: "10",
  quoteVolume: "1020",
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
    expect(() => validateCandles([candle(1_000, { high: "97" })])).toThrow(/high is below/);
    expect(() => validateCandles([candle(1_000, { volume: "-1" })])).toThrow(/plain decimal string/);
  });

  it("rejects malformed and non-positive prices", () => {
    expect(() => validateCandles([candle(1_000, { close: "NaN" })])).toThrow(/plain decimal string/);
    expect(() => validateCandles([candle(1_000, { open: "0" })])).toThrow(/prices must be positive/);
  });

  it("rejects overlapping candle time ranges", () => {
    const first = candle(1_000, { closeTime: 60_000 });
    const overlapping = candle(59_000, { closeTime: 100_000 });
    expect(() => validateCandles([first, overlapping])).toThrow(/overlaps the previous candle/);
  });

  it("compares decimal strings exactly beyond JavaScript number precision", () => {
    const precise = candle(1_000, {
      open: "1.000000000000000001",
      high: "1.000000000000000002",
      low: "1.000000000000000000",
      close: "1.000000000000000001",
    });
    expect(() => validateCandles([precise])).not.toThrow();
    expect(() => validateCandles([{
      ...precise,
      high: "1.000000000000000000",
    }])).toThrow(/high is below/);
  });
});
