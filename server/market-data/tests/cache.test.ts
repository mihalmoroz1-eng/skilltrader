import { describe, expect, it } from "vitest";
import { MarketDataCache } from "../core/MarketDataCache";
import type { MarketDataSnapshot } from "../core/MarketDataTypes";

const snapshot: MarketDataSnapshot = {
  symbol: "BTCUSDT",
  interval: "1m",
  source: "binance-spot",
  fetchedAt: 1_000,
  freshness: "live",
  candles: [{
    openTime: 1,
    closeTime: 60_000,
    open: "100",
    high: "101",
    low: "99",
    close: "100.5",
    volume: "1",
    quoteVolume: "100.5",
    tradeCount: 2,
  }],
};

describe("market data cache", () => {
  it("returns entries until their TTL expires", () => {
    const cache = new MarketDataCache(500, 2);
    cache.set("btc", snapshot, 1_000);
    expect(cache.get("btc", 1_499)).toEqual(snapshot);
    expect(cache.get("btc", 1_500)).toBeNull();
  });

  it("returns defensive copies", () => {
    const cache = new MarketDataCache();
    cache.set("btc", snapshot, 1_000);
    const result = cache.get("btc", 1_001)!;
    result.candles[0].close = "1";
    expect(cache.get("btc", 1_002)?.candles[0].close).toBe("100.5");
  });

  it("evicts the oldest inserted entry when capacity is reached", () => {
    const cache = new MarketDataCache(1_000, 1);
    cache.set("btc", snapshot, 1_000);
    cache.set("eth", { ...snapshot, symbol: "ETHUSDT" }, 1_000);
    expect(cache.get("btc", 1_001)).toBeNull();
    expect(cache.get("eth", 1_001)?.symbol).toBe("ETHUSDT");
  });
});
