import { MarketDataCache } from "../core/MarketDataCache";
import { validateCandles } from "../core/MarketDataValidator";
import {
  isMarketInterval,
  type MarketDataProvider,
  type MarketDataSnapshot,
  type MarketInterval,
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
    if (typeof symbolInput !== "string") {
      throw new MarketDataRequestError("Invalid market symbol");
    }
    const symbol = symbolInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
      throw new MarketDataRequestError("Invalid market symbol");
    }
    if (!isMarketInterval(intervalInput)) {
      throw new MarketDataRequestError("Unsupported candle interval");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MarketDataRequestError("Candle limit must be an integer from 1 to 1000");
    }

    const interval: MarketInterval = intervalInput;
    const cacheKey = `${this.provider.id}:${symbol}:${interval}:${limit}`;
    const cached = this.cache.get(cacheKey, this.now());
    if (cached) return { ...cached, freshness: "cached" };

    const candles = await this.provider.fetchCandles(symbol, interval, limit);
    validateCandles(candles);

    const fetchedAt = this.now();
    if (!Number.isFinite(fetchedAt) || fetchedAt < 0) {
      throw new MarketDataRequestError("Market data clock returned an invalid timestamp");
    }

    const snapshot: MarketDataSnapshot = {
      symbol,
      interval,
      source: this.provider.id,
      fetchedAt,
      freshness: "live",
      candles,
    };
    this.cache.set(cacheKey, snapshot, fetchedAt);
    return snapshot;
  }
}
