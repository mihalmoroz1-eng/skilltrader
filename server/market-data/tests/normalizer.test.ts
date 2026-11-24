import { describe, expect, it } from "vitest";
import { normalizeBinanceKlines, MarketDataNormalizationError } from "../core/MarketDataNormalizer";

const row = [
  1_700_000_000_000, "100", "105", "99", "103", "12.5",
  1_700_000_899_999, "1287.5", 42, "0", "0", "0",
];

describe("Binance kline normalizer", () => {
  it("maps the public REST kline tuple into canonical candle fields", () => {
    expect(normalizeBinanceKlines([row], "BTCUSDT", "15m")).toEqual([{
      openTime: 1_700_000_000_000,
      closeTime: 1_700_000_899_999,
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 12.5,
      quoteVolume: 1287.5,
      tradeCount: 42,
    }]);
  });

  it("rejects non-array payloads and malformed rows", () => {
    expect(() => normalizeBinanceKlines({}, "BTCUSDT", "15m")).toThrow(MarketDataNormalizationError);
    expect(() => normalizeBinanceKlines([[1, "2"]], "BTCUSDT", "15m")).toThrow(MarketDataNormalizationError);
  });

  it("rejects non-finite numeric fields", () => {
    expect(() => normalizeBinanceKlines([[...row.slice(0, 1), "NaN", ...row.slice(2)], "BTCUSDT", "15m"))
      .toThrow("Invalid Binance field: open");
  });
});
