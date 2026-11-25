import { describe, expect, it, vi } from "vitest";
import { BinanceSpotProvider } from "../providers/BinanceSpotProvider";

const binanceRow = [
  1_700_000_000_000, "100.000000000000000001", "105", "99", "103", "12.5",
  1_700_000_059_999, "1287.5", 42,
];

describe("Binance Spot public provider", () => {
  it("requests public klines without credentials and preserves decimal fields", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([binanceRow]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const provider = new BinanceSpotProvider(fetchMock as typeof fetch);
    const candles = await provider.fetchCandles("BTCUSDT", "1m", 2);

    expect(candles[0].open).toBe("100.000000000000000001");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toContain("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  it("surfaces Binance rate limiting as a typed provider error", async () => {
    const provider = new BinanceSpotProvider(
      vi.fn(async () => new Response("", { status: 429 })) as typeof fetch,
    );
    await expect(provider.fetchCandles("BTCUSDT", "1m", 2))
      .rejects.toMatchObject({ name: "MarketDataProviderError", kind: "rate-limit", status: 429 });
  });

  it("rejects malformed JSON responses", async () => {
    const provider = new BinanceSpotProvider(
      vi.fn(async () => new Response("not-json", { status: 200 })) as typeof fetch,
    );
    await expect(provider.fetchCandles("BTCUSDT", "1m", 2))
      .rejects.toMatchObject({ kind: "invalid-json" });
  });

  it("rejects oversized responses using the Content-Length header", async () => {
    const provider = new BinanceSpotProvider(
      vi.fn(async () => new Response("12345", {
        status: 200,
        headers: { "Content-Length": "5" },
      })) as typeof fetch,
      1_000,
      4,
    );
    await expect(provider.fetchCandles("BTCUSDT", "1m", 2))
      .rejects.toMatchObject({ kind: "response-too-large" });
  });

  it("enforces the response limit while streaming when Content-Length is absent", async () => {
    const provider = new BinanceSpotProvider(
      vi.fn(async () => new Response("12345", { status: 200 })) as typeof fetch,
      1_000,
      4,
    );
    await expect(provider.fetchCandles("BTCUSDT", "1m", 2))
      .rejects.toMatchObject({ kind: "response-too-large" });
  });

  it("classifies a request timeout without retrying", async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error("Timed out");
      error.name = "TimeoutError";
      throw error;
    });
    const provider = new BinanceSpotProvider(fetchMock as typeof fetch);
    await expect(provider.fetchCandles("BTCUSDT", "1m", 2))
      .rejects.toMatchObject({ kind: "timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates direct provider calls before making a request", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    const provider = new BinanceSpotProvider(fetchMock as typeof fetch);

    await expect(provider.fetchCandles("BTC/USDT", "1m", 2)).rejects.toMatchObject({ kind: "invalid-request" });
    await expect(provider.fetchCandles("BTCUSDT", "2w" as never, 2)).rejects.toMatchObject({ kind: "invalid-request" });
    await expect(provider.fetchCandles("BTCUSDT", "1m", 1_001)).rejects.toMatchObject({ kind: "invalid-request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
