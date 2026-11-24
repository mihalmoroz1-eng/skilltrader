import { validateCandles } from "../../market-data/core/MarketDataValidator";
import { isMarketInterval } from "../../market-data/core/MarketDataTypes";
import type {
  HistoricalCandleProvider,
  HistoricalCandleRecord,
  HistoricalCandleStore,
  HistoricalIngestionResult,
  HistoricalRange,
} from "./HistoricalDataTypes";

export class HistoricalDataRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalDataRequestError";
  }
}

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
  "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};

function intervalStep(interval: string, openTime: number): number {
  if (interval === "1M") {
    const date = new Date(openTime);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - openTime;
  }
  return INTERVAL_MS[interval] ?? 0;
}

function validateRange(input: HistoricalRange): void {
  if (!/^[A-Z0-9]{2,20}$/.test(input.symbol)) throw new HistoricalDataRequestError("Invalid symbol");
  if (!isMarketInterval(input.interval)) throw new HistoricalDataRequestError("Unsupported interval");
  if (!Number.isSafeInteger(input.startTime) || !Number.isSafeInteger(input.endTime) ||
      input.startTime < 0 || input.endTime <= input.startTime) {
    throw new HistoricalDataRequestError("Invalid historical time range");
  }
  if (input.endTime - input.startTime > 366 * 24 * 60 * 60 * 1000) {
    throw new HistoricalDataRequestError("Historical range cannot exceed 366 days per request");
  }
  const limit = input.pageLimit ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new HistoricalDataRequestError("Page limit must be from 1 to 1000");
  }
}

export class HistoricalDataIngestionService {
  constructor(
    private readonly provider: HistoricalCandleProvider,
    private readonly store: HistoricalCandleStore,
    private readonly now: () => number = Date.now,
  ) {
    if (!provider?.id?.trim()) throw new Error("Historical provider id is required");
  }

  async ingest(input: HistoricalRange): Promise<HistoricalIngestionResult> {
    validateRange(input);
    const pageLimit = input.pageLimit ?? 1000;
    const fetchedAt = this.now();
    if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) {
      throw new HistoricalDataRequestError("Invalid ingestion clock");
    }

    const byOpenTime = new Map<number, HistoricalCandleRecord>();
    let duplicatesRemoved = 0;
    let cursor = input.startTime;
    let pagesFetched = 0;
    const maxPages = Math.min(2_000, Math.ceil((input.endTime - input.startTime) / 60_000) + 1);

    while (cursor <= input.endTime && pagesFetched < maxPages) {
      const page = await this.provider.fetchCandles(
        input.symbol, input.interval, cursor, input.endTime, pageLimit,
      );
      pagesFetched += 1;
      if (!Array.isArray(page)) throw new HistoricalDataRequestError("Provider returned a non-array payload");
      if (page.length > pageLimit) throw new HistoricalDataRequestError("Provider exceeded requested page limit");
      if (page.length === 0) break;
      validateCandles(page);

      let lastOpenTime = -1;
      for (const candle of page) {
        if (candle.openTime < input.startTime || candle.openTime > input.endTime) continue;
        if (candle.openTime <= lastOpenTime) {
          throw new HistoricalDataRequestError("Provider page is not strictly ordered");
        }
        lastOpenTime = candle.openTime;
        if (candle.closeTime >= fetchedAt) continue;\n        const record: HistoricalCandleRecord = {
          ...candle, symbol: input.symbol, interval: input.interval,
          source: this.provider.id, fetchedAt,
        };
        const previous = byOpenTime.get(candle.openTime);
        if (previous) duplicatesRemoved += 1;
        if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
          throw new HistoricalDataRequestError("Conflicting duplicate candle returned by provider");
        }
        byOpenTime.set(candle.openTime, record);
      }

      const finalOpenTime = page[page.length - 1].openTime;
      if (finalOpenTime < cursor) throw new HistoricalDataRequestError("Provider pagination did not advance");
      const step = intervalStep(input.interval, finalOpenTime);
      if (step <= 0) throw new HistoricalDataRequestError("Unsupported interval step");
      const nextCursor = finalOpenTime + step;
      if (nextCursor <= cursor) throw new HistoricalDataRequestError("Provider pagination cursor stalled");
      cursor = nextCursor;
      if (page.length < pageLimit) break;
    }

    if (cursor <= input.endTime && pagesFetched >= maxPages) {
      throw new HistoricalDataRequestError("Historical pagination safety limit reached");
    }

    const candles = [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
    if (candles.length > 0) await this.store.upsert(candles);

    const gaps: HistoricalIngestionResult["quality"]["gaps"] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const previous = candles[i - 1];
      const expectedNextOpenTime = previous.openTime + intervalStep(input.interval, previous.openTime);
      if (candles[i].openTime > expectedNextOpenTime) {
        gaps.push({ previousOpenTime: previous.openTime, nextOpenTime: candles[i].openTime, expectedNextOpenTime });
      }
    }

    const expectedFirst = candles.length > 0 ? candles[0].openTime : null;
    const expectedLast = candles.length > 0 ? candles[candles.length - 1].openTime : null;
    return {
      symbol: input.symbol, interval: input.interval, source: this.provider.id,
      fetchedAt, candlesStored: candles.length, pagesFetched,
      quality: {
        requested: { startTime: input.startTime, endTime: input.endTime },
        returned: candles.length, duplicatesRemoved, gaps,
        firstOpenTime: expectedFirst, lastOpenTime: expectedLast,
        complete: candles.length > 0 && gaps.length === 0 &&
          candles[0].openTime <= input.startTime + intervalStep(input.interval, input.startTime) &&
          candles[candles.length - 1].openTime >= input.endTime - intervalStep(input.interval, input.endTime),
      },
    };
  }

  async query(input: HistoricalRange & { limit?: number }): Promise<HistoricalCandleRecord[]> {
    validateRange(input);
    const limit = input.limit ?? 10_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
      throw new HistoricalDataRequestError("Query limit must be from 1 to 100000");
    }
    return this.store.list(input.symbol, input.interval, input.startTime, input.endTime, limit);
  }
}
