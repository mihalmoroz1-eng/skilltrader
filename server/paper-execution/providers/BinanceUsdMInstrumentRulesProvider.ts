import type { PaperInstrumentRules } from "../core/PaperExecutionEngine";
import { FuturesProviderError } from "../../futures-intelligence/providers/BinanceUsdMFuturesProvider";

export interface PaperInstrumentRulesProvider {
  getRules(symbol: string): Promise<PaperInstrumentRules>;
}

const URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const MAX_BYTES = 4 * 1024 * 1024;

export function parseBinanceInstrumentRules(payload: unknown, symbol: string): PaperInstrumentRules {
  if (!payload || typeof payload !== "object" || !("symbols" in payload) || !Array.isArray(payload.symbols)) {
    throw new FuturesProviderError("Invalid exchange information payload", "invalid-json");
  }
  const item = payload.symbols.find((entry: unknown) =>
    typeof entry === "object" && entry !== null && "symbol" in entry && entry.symbol === symbol);
  if (!item || typeof item !== "object" || !("filters" in item) || !Array.isArray(item.filters) ||
      !("status" in item) || item.status !== "TRADING" ||
      !("contractType" in item) || item.contractType !== "PERPETUAL" ||
      !("quoteAsset" in item) || item.quoteAsset !== "USDT") {
    throw new FuturesProviderError("Instrument is not an active USDT-M perpetual contract", "invalid-request");
  }
  const filters = item.filters as Array<Record<string, unknown>>;
  const priceFilter = filters.find(filter => filter.filterType === "PRICE_FILTER");
  const marketLot = filters.find(filter => filter.filterType === "MARKET_LOT_SIZE");
  const lot = filters.find(filter => filter.filterType === "LOT_SIZE");
  const lotFilter = marketLot && typeof marketLot.stepSize === "string" && marketLot.stepSize !== "0" ? marketLot : lot;
  if (!priceFilter || !lotFilter ||
      typeof priceFilter.tickSize !== "string" ||
      typeof lotFilter.stepSize !== "string" || typeof lotFilter.minQty !== "string") {
    throw new FuturesProviderError("Instrument filters are incomplete", "invalid-json");
  }
  for (const value of [priceFilter.tickSize, lotFilter.stepSize, lotFilter.minQty]) {
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) || Number(value) <= 0) {
      throw new FuturesProviderError("Instrument filters contain invalid decimals", "invalid-json");
    }
  }
  return {
    symbol, contractMultiplier: "1",
    tickSize: priceFilter.tickSize,
    quantityStep: lotFilter.stepSize,
    minimumQuantity: lotFilter.minQty,
  };
}

export class BinanceUsdMInstrumentRulesProvider implements PaperInstrumentRulesProvider {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly timeoutMs = 10_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be positive");
  }

  async getRules(symbol: string): Promise<PaperInstrumentRules> {
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
      throw new FuturesProviderError("Invalid symbol", "invalid-request");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(URL, {
        method: "GET", headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new FuturesProviderError(timeout ? "Exchange info request timed out" : "Exchange info request failed",
        timeout ? "timeout" : "network");
    }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* preserve status */ }
      if (response.status === 418 || response.status === 429) {
        throw new FuturesProviderError("Binance Futures rate limit", "rate-limit", response.status);
      }
      throw new FuturesProviderError(`Binance Futures returned HTTP ${response.status}`, "http", response.status);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && /^[0-9]+$/.test(contentLength) && Number(contentLength) > MAX_BYTES) {
      try { await response.body?.cancel(); } catch { /* preserve size error */ }
      throw new FuturesProviderError("Exchange info response too large", "response-too-large", response.status);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
      throw new FuturesProviderError("Exchange info response too large", "response-too-large", response.status);
    }
    let payload: unknown;
    try { payload = JSON.parse(text) as unknown; }
    catch { throw new FuturesProviderError("Invalid exchange info JSON", "invalid-json", response.status); }
    return parseBinanceInstrumentRules(payload, symbol);
  }
}
