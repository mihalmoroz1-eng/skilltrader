import { describe, expect, it, vi } from "vitest";
import { MarketDataCache } from "../core/MarketDataCache";
import { MarketDataService, MarketDataRequestError } from "../services/MarketDataService";
import type { MarketCandle, MarketDataProvider } from "../core/MarketDataTypes";

const validCandle: MarketCandle = {
  openTime: 1_700_000_000_000,
  closeTime: 1_700_000_059_999,
  open: "100",
  high: "105",
  low: "99",
  close: "103",
  volume: "12.5",
  quoteVolume: "1287.5",
  tradeCount: 42,
};

function createProvider(candles: MarketCandle[]): MarketDataProvider {
  return {
    id: "test-provider",
    fetchCandles: vi.fn(async () => candles),
  };
}

describe("market data service", () => {
  it("validates, caches and identifies cached snapshots", async () => {
    const provider = createProvider([validCandle]);
    const service = new MarketDataService(provider, new MarketDataCache(5_000), () => 10_000);

    const first = await service.getCandles("btcusdt", "1m", 1);
    const second = await service.getCandles("BTCUSDT", "1m", 1);

    expect(first.symbol).toBe("BTCUSDT");
    expect(first.source).toBe("test-provider");
    expect(first.freshness).toBe("live");
    expect(first.candles[0].close).toBe("103");
    expect(second).toEqual({ ...first, freshness: "cached" });
    expect(provider.fetchCandles).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid symbols, intervals and limits before network access", async () => {
    const provider = createProvider([validCandle]);
    const service = new MarketDataService(provider);

    await expect(service.getCandles("BTC/USDT", "1m")).rejects.toThrow(MarketDataRequestError);
    await expect(service.getCandles("BTCUSDT", "2w")).rejects.toThrow(MarketDataRequestError);
    await expect(service.getCandles("BTCUSDT", "1m", 1_001)).rejects.toThrow(MarketDataRequestError);
    expect(provider.fetchCandles).not.toHaveBeenCalled();
  });

  it("does not cache invalid provider data", async () => {
    const provider = createProvider([{ ...validCandle, high: "98" }]);
    const service = new MarketDataService(provider);

    await expect(service.getCandles("BTCUSDT", "1m", 1)).rejects.toThrow();
    await expect(service.getCandles("BTCUSDT", "1m", 1)).rejects.toThrow();
    expect(provider.fetchCandles).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid clock values instead of caching them", async () => {
    const provider = createProvider([validCandle]);
    const service = new MarketDataService(provider, new MarketDataCache(), () => Number.NaN);
    await expect(service.getCandles("BTCUSDT", "1m", 1)).rejects.toThrow(/invalid timestamp/);
  });
});
