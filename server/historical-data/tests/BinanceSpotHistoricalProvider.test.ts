import { describe, expect, it, vi } from "vitest";
import { BinanceSpotHistoricalProvider } from "../providers/BinanceSpotHistoricalProvider";

const row = [
  1_700_000_000_000, "100.000000000000000001", "105", "99", "103", "12.5",
  1_700_000_059_999, "1287.5", 42,
];

describe("Binance Spot historical provider", () => {
  it("requests a bounded public kline range and preserves decimal strings", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([row]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const provider = new BinanceSpotHistoricalProvider(fetchMock as typeof fetch);
    const candles = await provider.fetchCandles("BTCUSDT", "1m", 1_700_000_000_000, 1_700_000_060_000, 100);

    expect(candles[0].open).toBe("100.000000000000000001");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.binance.com");
    expect(url.pathname).toBe("/api/v3/klines");
    expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
    expect(url.searchParams.get("interval")).toBe("1m");
    expect(url.searchParams.get("startTime")).toBe("1700000000000");
    expect(url.searchParams.get("endTime")).toBe("1700000060000");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  it("rejects oversized streamed responses before buffering the full body", async () => {
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        controller.close();
      },
    }), { status: 200 }));
    const provider = new BinanceSpotHistoricalProvider(fetchMock as typeof fetch);
    await expect(provider.fetchCandles("BTCUSDT", "1m", 1_700_000_000_000, 1_700_000_060_000, 100))
      .rejects.toMatchObject({ name: "MarketDataProviderError", kind: "response-too-large" });
  });

  it("classifies Binance rate limiting", async () => {
    const provider = new BinanceSpotHistoricalProvider(
      vi.fn(async () => new Response("", { status: 429 })) as typeof fetch,
    );
    await expect(provider.fetchCandles("BTCUSDT", "1m", 1_700_000_000_000, 1_700_000_060_000, 100))
      .rejects.toMatchObject({ kind: "rate-limit", status: 429 });
  });

  it("rejects invalid ranges before making a request", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    const provider = new BinanceSpotHistoricalProvider(fetchMock as typeof fetch);
    await expect(provider.fetchCandles("BTCUSDT", "1m", 20, 10, 100))
      .rejects.toMatchObject({ kind: "invalid-request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
