import { normalizeBinanceKlines } from "../../market-data/core/MarketDataNormalizer";
import type { MarketInterval } from "../../market-data/core/MarketDataTypes";
import { MarketDataProviderError } from "../../market-data/providers/BinanceSpotProvider";
import type { HistoricalCandleProvider } from "../core/HistoricalDataTypes";

const BASE_URL = "https://api.binance.com";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class BinanceSpotHistoricalProvider implements HistoricalCandleProvider {
  readonly id = "binance-spot";

  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly timeoutMs = 10_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be positive");
  }

  async fetchCandles(
    symbol: string, interval: MarketInterval, startTime: number, endTime: number, limit: number,
  ) {
    if (!/^[A-Z0-9]{2,20}$/.test(symbol) ||
        !Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) ||
        startTime < 0 || endTime <= startTime || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MarketDataProviderError("Invalid historical request", "invalid-request");
    }

    const url = new URL("/api/v3/klines", BASE_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", String(startTime));
    url.searchParams.set("endTime", String(endTime));
    url.searchParams.set("limit", String(limit));

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET", headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MarketDataProviderError(timeout ? "Historical request timed out" : "Historical request failed",
        timeout ? "timeout" : "network");
    }

    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* preserve provider status */ }
      if (response.status === 418 || response.status === 429) {
        throw new MarketDataProviderError("Binance rate limit", "rate-limit", response.status);
      }
      throw new MarketDataProviderError(`Binance returned HTTP ${response.status}`, "http", response.status);
    }

    const length = response.headers.get("content-length");
    if (length && /^[0-9]+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw new MarketDataProviderError("Historical response too large", "response-too-large", response.status);
    }

    let text: string;
    if (!response.body) {
      try {
        text = await response.text();
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new MarketDataProviderError(timeout ? "Historical response timed out" : "Historical response failed",
          timeout ? "timeout" : "network", response.status);
      }
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new MarketDataProviderError("Historical response too large", "response-too-large", response.status);
      }
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            try { await reader.cancel(); } catch { /* preserve size error */ }
            throw new MarketDataProviderError("Historical response too large", "response-too-large", response.status);
          }
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof MarketDataProviderError) throw error;
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new MarketDataProviderError(timeout ? "Historical response timed out" : "Historical response failed",
          timeout ? "timeout" : "network", response.status);
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
        text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      } catch {
        throw new MarketDataProviderError("Invalid historical response encoding", "invalid-json", response.status);
      }
    }

    let payload: unknown;
    try { payload = JSON.parse(text) as unknown; }
    catch { throw new MarketDataProviderError("Invalid historical JSON", "invalid-json", response.status); }
    return normalizeBinanceKlines(payload);
  }
}
