import { MarketDataCache } from "../core/MarketDataCache";
import { normalizeBinanceKlines } from "../core/MarketDataNormalizer";
import { validateCandles } from "../core/MarketDataValidator";
import {
  isBinanceInterval,
  type BinanceInterval,
  type MarketDataProvider,
  type MarketDataSnapshot,
} from "../core/MarketDataTypes";

export class MarketDataRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataRequestError";
  }
}

export class MarketDataService {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly cache = new MarketDataCache(),
    private readonly now: () => number = Date.now,
  ) {}

  async getCandles(
    symbolInput: string,
    intervalInput: string,
    limit = 500,
  ): Promise<MarketDataSnapshot> {
    const symbol = symbolInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
      throw new MarketDataRequestError("Invalid market symbol");
    }
    if (!isBinanceInterval(intervalInput)) {
      throw new MarketDataRequestError("Unsupported candle interval");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MarketDataRequestError("Candle limit must be an integer from 1 to 1000");
    }

    const interval: BinanceInterval = intervalInput;
    const cacheKey = `${this.provider.id}:${symbol}:${interval}:${limit}`;
    const cached = this.cache.get(cacheKey, this.now());
    if (cached) return cached;

    const raw = await this.provider.fetchCandles(symbol, interval, limit);
    const candles = normalizeBinanceKlines(raw, symbol, interval);
    validateCandles(candles);

    const snapshot: MarketDataSnapshot = {
      symbol,
      interval,
      source: this.provider.id,
      fetchedAt: this.now(),
      freshness: "live",
      candles,
    };
    this.cache.set(cacheKey, snapshot, snapshot.fetchedAt);
    return snapshot;
  }
}
