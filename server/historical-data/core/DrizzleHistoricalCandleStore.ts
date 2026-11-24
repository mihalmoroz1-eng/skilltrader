import { and, asc, eq, gte, lte } from "drizzle-orm";
import { historicalCandles } from "../../../drizzle/schema";
import { isMarketInterval } from "../../market-data/core/MarketDataTypes";
import { getDb } from "../../db";
import type { HistoricalCandleRecord, HistoricalCandleStore } from "./HistoricalDataTypes";

export class DrizzleHistoricalCandleStore implements HistoricalCandleStore {
  async upsert(records: HistoricalCandleRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await getDb();
    if (!db) throw new Error("Historical database is unavailable");

    for (const record of records) {
      await db.insert(historicalCandles).values(record).onDuplicateKeyUpdate({
        set: {
          closeTime: record.closeTime, open: record.open, high: record.high,
          low: record.low, close: record.close, volume: record.volume,
          quoteVolume: record.quoteVolume, tradeCount: record.tradeCount,
          source: record.source, fetchedAt: record.fetchedAt,
        },
      });
    }
  }

  async list(symbol: string, interval: string, startTime: number, endTime: number, limit: number) {
    const db = await getDb();
    if (!db) throw new Error("Historical database is unavailable");
    const rows = await db.select().from(historicalCandles).where(and(
      eq(historicalCandles.symbol, symbol), eq(historicalCandles.interval, interval),
      gte(historicalCandles.openTime, startTime), lte(historicalCandles.openTime, endTime),
    )).orderBy(asc(historicalCandles.openTime)).limit(limit);

    return rows.map(({ id: _id, ...row }) => {
      if (!isMarketInterval(row.interval)) {
        throw new Error("Historical database contains an unsupported interval");
      }
      return { ...row, interval: row.interval };
    });
  }
}
