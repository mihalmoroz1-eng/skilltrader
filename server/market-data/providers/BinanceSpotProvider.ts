import { isMarketInterval, type MarketCandle, type MarketDataProvider, type MarketInterval } from "../core/MarketDataTypes";
import { normalizeBinanceKlines } from "../core/MarketDataNormalizer";

export type MarketDataProviderErrorKind =
  | "timeout"
  | "network"
  | "http"
  | "rate-limit"
  | "response-too-large"
  | "invalid-json"
  | "invalid-request";

export class MarketDataProviderError extends Error {
  constructor(
    message: string,
    readonly kind: MarketDataProviderErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MarketDataProviderError";
  }
}

const BINANCE_SPOT_BASE_URL = "https://api.binance.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already closing; preserve the original provider error.
  }
}

async function readJsonBody(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^[0-9]+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await cancelResponseBody(response);
    throw new MarketDataProviderError(
      "Binance response exceeded the configured size limit",
      "response-too-large",
      response.status,
    );
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new MarketDataProviderError("Binance response exceeded the configured size limit", "response-too-large");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MarketDataProviderError("Binance returned invalid JSON", "invalid-json", response.status);
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch { /* Ignore stream cancellation errors. */ }
        throw new MarketDataProviderError(
          "Binance response exceeded the configured size limit",
          "response-too-large",
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as unknown;
  } catch {
    throw new MarketDataProviderError("Binance returned invalid JSON", "invalid-json", response.status);
  }
}

export class BinanceSpotProvider implements MarketDataProvider {
  readonly id = "binance-spot";

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new Error("timeoutMs must be positive");
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
      throw new Error("maxResponseBytes must be a positive integer");
    }
  }

  async fetchCandles(symbol: string, interval: MarketInterval, limit: number): Promise<MarketCandle[]> {
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
      throw new MarketDataProviderError("Invalid market symbol", "invalid-request");
    }
    if (!isMarketInterval(interval)) {
      throw new MarketDataProviderError("Unsupported candle interval", "invalid-request");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MarketDataProviderError("Invalid candle limit", "invalid-request");
    }

    const url = new URL("/api/v3/klines", BINANCE_SPOT_BASE_URL);
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
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MarketDataProviderError(
        timedOut ? "Binance request timed out" : "Binance request failed",
        timedOut ? "timeout" : "network",
      );
    }

    if (!response.ok) {
      const status = response.status;
      await cancelResponseBody(response);
      if (status === 418 || status === 429) {
        throw new MarketDataProviderError("Binance rate limit or temporary IP restriction", "rate-limit", status);
      }
      throw new MarketDataProviderError(`Binance returned HTTP ${status}`, "http", status);
    }

    const payload = await readJsonBody(response, this.maxResponseBytes);
    return normalizeBinanceKlines(payload);
  }
}
