import type { FuturesMarketProvider, FuturesRawSnapshot } from "../core/FuturesLiquidityTypes";

const BASE_URL = "https://fapi.binance.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export class FuturesProviderError extends Error {
  constructor(message: string, readonly kind: "timeout" | "network" | "http" | "rate-limit" | "invalid-json" | "response-too-large" | "invalid-request", readonly status?: number) {
    super(message);
    this.name = "FuturesProviderError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && /^[0-9]+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch { /* preserve size error */ }
    throw new FuturesProviderError("Futures response too large", "response-too-large", response.status);
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new FuturesProviderError("Futures response too large", "response-too-large", response.status);
    }
    try { return JSON.parse(text) as unknown; }
    catch { throw new FuturesProviderError("Futures response is not valid JSON", "invalid-json", response.status); }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new FuturesProviderError("Futures response too large", "response-too-large", response.status);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FuturesProviderError) throw error;
    throw new FuturesProviderError("Futures response stream failed", "network", response.status);
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown; }
  catch { throw new FuturesProviderError("Futures response is not valid JSON", "invalid-json", response.status); }
}

export class BinanceUsdMFuturesProvider implements FuturesMarketProvider {
  readonly id = "binance-usdm-futures";

  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be positive");
  }

  async fetchSnapshot(symbol: string, depthLimit: number): Promise<FuturesRawSnapshot> {
    if (!/^[A-Z0-9]{2,20}$/.test(symbol) || !Number.isInteger(depthLimit) || depthLimit < 5 || depthLimit > 1000) {
      throw new FuturesProviderError("Invalid futures market request", "invalid-request");
    }

    const requests = [
      { key: "depth", path: "/fapi/v1/depth", params: { symbol, limit: String(depthLimit) } },
      { key: "premium", path: "/fapi/v1/premiumIndex", params: { symbol } },
      { key: "openInterest", path: "/fapi/v1/openInterest", params: { symbol } },
    ] as const;

    const fetchOne = async (request: typeof requests[number]) => {
      const url = new URL(request.path, BASE_URL);
      for (const [key, value] of Object.entries(request.params)) url.searchParams.set(key, value);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET", headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new FuturesProviderError(timeout ? "Futures request timed out" : "Futures request failed",
          timeout ? "timeout" : "network");
      }
      if (!response.ok) {
        try { await response.body?.cancel(); } catch { /* preserve status */ }
        if (response.status === 418 || response.status === 429) {
          throw new FuturesProviderError("Binance Futures rate limit", "rate-limit", response.status);
        }
        throw new FuturesProviderError(`Binance Futures returned HTTP ${response.status}`, "http", response.status);
      }
      return readJson(response);
    };

    const [depth, premium, interest] = await Promise.all(requests.map(fetchOne));
    if (!depth || typeof depth !== "object" || !premium || typeof premium !== "object" ||
        !interest || typeof interest !== "object") {
      throw new FuturesProviderError("Futures endpoints returned malformed payloads", "invalid-json");
    }
    const d = depth as Record<string, unknown>;
    const p = premium as Record<string, unknown>;
    const o = interest as Record<string, unknown>;
    if (p.symbol !== symbol || o.symbol !== symbol || typeof d.lastUpdateId !== "number" ||
        !Array.isArray(d.bids) || !Array.isArray(d.asks) ||
        typeof p.markPrice !== "string" || typeof p.indexPrice !== "string" ||
        typeof p.lastFundingRate !== "string" || typeof p.nextFundingTime !== "number" ||
        typeof o.openInterest !== "string") {
      throw new FuturesProviderError("Futures endpoints returned unexpected fields", "invalid-json");
    }
    const normalizeLevels = (value: unknown[]): Array<{ price: string; quantity: string }> =>
      value.map(level => {
        if (!Array.isArray(level) || typeof level[0] !== "string" || typeof level[1] !== "string") {
          throw new FuturesProviderError("Malformed order-book level", "invalid-json");
        }
        return { price: level[0], quantity: level[1] };
      });

    const fetchedAt = this.now();
    if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) {
      throw new FuturesProviderError("Invalid provider clock", "network");
    }
    return {
      symbol, source: this.id, fetchedAt,
      orderBook: {
        lastUpdateId: d.lastUpdateId,
        bids: normalizeLevels(d.bids),
        asks: normalizeLevels(d.asks),
      },
      markPrice: p.markPrice, indexPrice: p.indexPrice,
      fundingRate: p.lastFundingRate, nextFundingTime: p.nextFundingTime,
      openInterest: o.openInterest,
    };
  }
}
