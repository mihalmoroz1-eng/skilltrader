import { describe, expect, it } from "vitest";
import { marketDataRequestSchema } from "@shared/marketData";

describe("market data request schema", () => {
  it("normalizes symbols and defaults the bounded candle limit", () => {
    expect(marketDataRequestSchema.parse({ symbol: " btcusdt ", interval: "1m" })).toEqual({
      symbol: "BTCUSDT",
      interval: "1m",
      limit: 500,
    });
  });

  it("rejects malformed symbols, unsupported intervals and excessive limits", () => {
    expect(() => marketDataRequestSchema.parse({ symbol: "BTC/USDT", interval: "1m" })).toThrow();
    expect(() => marketDataRequestSchema.parse({ symbol: "BTCUSDT", interval: "2w" })).toThrow();
    expect(() => marketDataRequestSchema.parse({ symbol: "BTCUSDT", interval: "1m", limit: 1_001 })).toThrow();
  });
});
