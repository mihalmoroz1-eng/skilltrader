import { describe, expect, it } from "vitest";
import { normalizeBinanceKlines, MarketDataNormalizationError } from "../core/MarketDataNormalizer";

const row = [
  1_700_000_000_000,
  "100.000000000000000001",
  "105.000000000000000003",
  "99.000000000000000001",
  "103.000000000000000002",
  "12.500000000000000001",
  1_700_000_899_999,
  "1287.500000000000000025",
  42,
  "0",
  "0",
  "0",
];

describe("Binance kline normalizer", () => {
  it("maps REST kline tuples and preserves exact decimal strings", () => {
    expect(normalizeBinanceKlines([row])).toEqual([{
      openTime: 1_700_000_000_000,
      closeTime: 1_700_000_899_999,
      open: "100.000000000000000001",
      high: "105.000000000000000003",
      low: "99.000000000000000001",
      close: "103.000000000000000002",
      volume: "12.500000000000000001",
      quoteVolume: "1287.500000000000000025",
      tradeCount: 42,
    }]);
  });

  it("rejects non-array payloads and malformed rows", () => {
    expect(() => normalizeBinanceKlines({})).toThrow(MarketDataNormalizationError);
    expect(() => normalizeBinanceKlines([[1, "2"]])).toThrow(MarketDataNormalizationError);
  });

  it("rejects malformed decimal strings and unsafe timestamps", () => {
    expect(() => normalizeBinanceKlines([[...row.slice(0, 1), " 1.2", ...row.slice(2)]]))
      .toThrow("Invalid Binance decimal field: open");
    expect(() => normalizeBinanceKlines([[Number.MAX_SAFE_INTEGER + 1, ...row.slice(1)]]))
      .toThrow("Invalid Binance integer field: openTime");
  });
});
