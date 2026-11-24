import { and, asc, eq, gte, lte } from "drizzle-orm";
import { historicalCandles } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { HistoricalCandleRecord, HistoricalCandleStore } from "./HistoricalDataTypes";

export class DrizzleHistoricalCandleStore implements HistoricalCandleStore {
  async upsert(records: HistoricalCandleRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await getDb();
    if (!db) throw new Error("Historical database is unavailable");

    for (let offset = 0; offset < records.length; offset += 500) {
      const batch = records.slice(offset, offset + 500);
      await db.insert(historicalCandles).values(batch).onDuplicateKeyUpdate({
        set: {
          closeTime: batch[0].closeTime, open: batch[0].open, high: batch[0].high,
          low: batch[0].low, close: batch[0].close, volume: batch[0].volume,
          quoteVolume: batch[0].quoteVolume, tradeCount: batch[0].tradeCount,
          source: batch[0].source, fetchedAt: batch[0].fetchedAt,
        },
      });
    }
  }

  async list(symbol: string, interval: string, startTime: number, endTime: number, limit: number) {
    const db = await getDb();
    if (!db) throw new Error("Historical database is unavailable");
    return db.select().from(historicalCandles).where(and(
      eq(historicalCandles.symbol, symbol), eq(historicalCandles.interval, interval),
      gte(historicalCandles.openTime, startTime), lte(historicalCandles.openTime, endTime),
    )).orderBy(asc(historicalCandles.openTime)).limit(limit);
  }
}
