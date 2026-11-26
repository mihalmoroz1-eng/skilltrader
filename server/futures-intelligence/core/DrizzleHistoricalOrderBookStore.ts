import { and, asc, desc, eq, gte, lte, lt } from "drizzle-orm";
import { futuresOrderBookSnapshots } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { HistoricalOrderBookSnapshotRecord, HistoricalOrderBookStore } from "./HistoricalOrderBookTypes";

export class DrizzleHistoricalOrderBookStore implements HistoricalOrderBookStore {
  async upsert(record: HistoricalOrderBookSnapshotRecord): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("Historical order-book database is unavailable");
    await db.insert(futuresOrderBookSnapshots).values(record).onDuplicateKeyUpdate({
      set: {
        source: record.source,
        fetchedAt: record.fetchedAt,
        bestBid: record.bestBid,
        bestAsk: record.bestAsk,
        bidsJson: record.bidsJson,
        asksJson: record.asksJson,
        bidLevels: record.bidLevels,
        askLevels: record.askLevels,
        contentDigest: record.contentDigest,
      },
    });
  }

  async list(symbol: string, startTime: number, endTime: number, limit: number) {
    const db = await getDb();
    if (!db) throw new Error("Historical order-book database is unavailable");
    const rows = await db.select().from(futuresOrderBookSnapshots).where(and(
      eq(futuresOrderBookSnapshots.symbol, symbol),
      gte(futuresOrderBookSnapshots.observedAt, startTime),
      lte(futuresOrderBookSnapshots.observedAt, endTime),
    )).orderBy(asc(futuresOrderBookSnapshots.observedAt)).limit(limit);
    return rows.map(({ id: _id, ...record }) => record);
  }

  async latestAtOrBefore(symbol: string, timestamp: number) {
    const db = await getDb();
    if (!db) throw new Error("Historical order-book database is unavailable");
    const rows = await db.select().from(futuresOrderBookSnapshots).where(and(
      eq(futuresOrderBookSnapshots.symbol, symbol),
      lte(futuresOrderBookSnapshots.observedAt, timestamp),
    )).orderBy(desc(futuresOrderBookSnapshots.observedAt)).limit(1);
    if (rows.length === 0) return null;
    const { id: _id, ...record } = rows[0];
    return record;
  }
}
