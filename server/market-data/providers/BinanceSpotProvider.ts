import type { BinanceInterval, MarketDataProvider } from "../core/MarketDataTypes";

export class MarketDataProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MarketDataProviderError";
  }
}

type FetchLike = typeof fetch;

export class BinanceSpotProvider implements MarketDataProvider {
  readonly id = "binance-spot" as const;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = "https://api.binance.com",
    private readonly timeoutMs = 10_000,
  ) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Binance provider requires HTTPS");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be positive");
    }
  }

  async fetchCandles(symbol: string, interval: BinanceInterval, limit: number): Promise<unknown> {
    const url = new URL("/api/v3/klines", this.baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "Binance request timed out"
        : "Binance request failed";
      throw new MarketDataProviderError(message);
    }

    if (!response.ok) {
      const status = response.status;
      const message = status === 418 || status === 429
        ? "Binance rate limit or temporary IP restriction"
        : `Binance returned HTTP ${status}`;
      throw new MarketDataProviderError(message, status);
    }

    try {
      return await response.json();
    } catch {
      throw new MarketDataProviderError("Binance returned invalid JSON", response.status);
    }
  }
}
