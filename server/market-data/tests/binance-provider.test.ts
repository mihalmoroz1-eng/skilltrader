import { describe, expect, it, vi } from "vitest";
import { BinanceSpotProvider, MarketDataProviderError } from "../providers/BinanceSpotProvider";

describe("Binance Spot public provider", () => {
  it("requests public klines without credentials", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2");
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new BinanceSpotProvider(fetchMock as typeof fetch);
    await expect(provider.fetchCandles("BTCUSDT", "1m", 2)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Accept: "application/json" });
  });

  it("surfaces rate limiting as a typed provider error", async () => {
    const provider = new BinanceSpotProvider(
      vi.fn(async () => new Response("", { status: 429 })) as typeof fetch,
    );
    await expect(provider.fetchCandles("BTCUSDT", "1m", 2))
      .rejects.toMatchObject({ name: "MarketDataProviderError", status: 429 });
  });

  it("rejects non-HTTPS provider endpoints outside localhost", () => {
    expect(() => new BinanceSpotProvider(fetch, "http://api.binance.com")).toThrow(/requires HTTPS/);
  });
});
