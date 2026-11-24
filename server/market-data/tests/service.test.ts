import { describe, expect, it, vi } from "vitest";
import { MarketDataCache } from "../core/MarketDataCache";
import { MarketDataService, MarketDataRequestError } from "../services/MarketDataService";
import type { MarketDataProvider } from "../core/MarketDataTypes";

const validRow = [
  1_700_000_000_000, "100", "105", "99", "103", "12.5",
  1_700_000_899_999, "1287.5", 42,
];

function createProvider(payload: unknown): MarketDataProvider {
  return {
    id: "binance-spot",
    fetchCandles: vi.fn(async () => payload),
  };
}

describe("market data service", () => {
  it("normalizes, validates and caches a provider response", async () => {
    const provider = createProvider([validRow]);
    const service = new MarketDataService(provider, new MarketDataCache(5_000), () => 10_000);

    const first = await service.getCandles("btcusdt", "1m", 1);
    const second = await service.getCandles("BTCUSDT", "1m", 1);

    expect(first.symbol).toBe("BTCUSDT");
    expect(first.source).toBe("binance-spot");
    expect(first.freshness).toBe("live");
    expect(first.candles[0].close).toBe(103);
    expect(second).toEqual({ ...first, freshness: "cached" });
    expect(provider.fetchCandles).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid symbols, intervals and limits before network access", async () => {
    const provider = createProvider([validRow]);
    const service = new MarketDataService(provider);

    await expect(service.getCandles("BTC/USDT", "1m")).rejects.toThrow(MarketDataRequestError);
    await expect(service.getCandles("BTCUSDT", "2w")).rejects.toThrow(MarketDataRequestError);
    await expect(service.getCandles("BTCUSDT", "1m", 1_001)).rejects.toThrow(MarketDataRequestError);
    expect(provider.fetchCandles).not.toHaveBeenCalled();
  });

  it("does not cache invalid provider data", async () => {
    const provider = createProvider([[...validRow.slice(0, 1), "0", ...validRow.slice(2)]]);
    const service = new MarketDataService(provider);

    await expect(service.getCandles("BTCUSDT", "1m", 1)).rejects.toThrow();
    await expect(service.getCandles("BTCUSDT", "1m", 1)).rejects.toThrow();
    expect(provider.fetchCandles).toHaveBeenCalledTimes(2);
  });
});
