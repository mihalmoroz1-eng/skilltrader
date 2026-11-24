import { describe, expect, it, vi } from "vitest";
import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import { HistoricalDataIngestionService } from "../core/HistoricalDataIngestionService";
import type { HistoricalCandleProvider, HistoricalCandleRecord, HistoricalCandleStore } from "../core/HistoricalDataTypes";

const minute = 60_000;
function candle(openTime: number): MarketCandle {
  return { openTime, closeTime: openTime + minute - 1, open: "100", high: "105", low: "99",
    close: "101", volume: "10.25", quoteVolume: "1025", tradeCount: 12 };
}
class MemoryStore implements HistoricalCandleStore {
  records = new Map<number, HistoricalCandleRecord>();
  async upsert(records: HistoricalCandleRecord[]) { for (const record of records) this.records.set(record.openTime, record); }
  async list(symbol: string, interval: MarketInterval, startTime: number, endTime: number, limit: number) {
    return [...this.records.values()].filter(r => r.symbol === symbol && r.interval === interval && r.openTime >= startTime && r.openTime <= endTime)
      .sort((a, b) => a.openTime - b.openTime).slice(0, limit);
  }
}
function provider(fetchCandles: HistoricalCandleProvider["fetchCandles"]): HistoricalCandleProvider {
  return { id: "fixture", fetchCandles: vi.fn(fetchCandles) };
}
describe("historical data ingestion", () => {
  it("paginates, stores decimal strings and reports contiguous data", async () => {
    const start = 1_700_000_000_000;
    const p = provider(async (_s, _i, from) => from === start ? [candle(start), candle(start + minute)] : [candle(start + 2 * minute)]);
    const store = new MemoryStore();
    const service = new HistoricalDataIngestionService(p, store, () => start + 10_000);
    const result = await service.ingest({ symbol: "BTCUSDT", interval: "1m", startTime: start, endTime: start + 2 * minute, pageLimit: 2 });
    expect(result.pagesFetched).toBe(2);
    expect(result.candlesStored).toBe(3);
    expect(result.quality.gaps).toHaveLength(0);
    expect(result.quality.complete).toBe(true);
    expect((await service.query({ symbol: "BTCUSDT", interval: "1m", startTime: start, endTime: start + 2 * minute, limit: 10 }))[0].volume).toBe("10.25");
  });
  it("detects missing intervals", async () => {
    const start = 1_700_000_000_000;
    const p = provider(async () => [candle(start), candle(start + 2 * minute)]);
    const result = await new HistoricalDataIngestionService(p, new MemoryStore()).ingest({ symbol: "BTCUSDT", interval: "1m", startTime: start, endTime: start + 2 * minute });
    expect(result.quality.gaps).toHaveLength(1);
    expect(result.quality.complete).toBe(false);
  });
  it("rejects invalid ranges before provider access", async () => {
    const p = provider(async () => []);
    const service = new HistoricalDataIngestionService(p, new MemoryStore());
    await expect(service.ingest({ symbol: "BTCUSDT", interval: "1m", startTime: 20, endTime: 10 })).rejects.toThrow(/Invalid historical time range/);
    expect(p.fetchCandles).not.toHaveBeenCalled();
  });
  it("rejects out-of-order provider pages", async () => {
    const start = 1_700_000_000_000;
    const p = provider(async () => [candle(start + minute), candle(start)]);
    const service = new HistoricalDataIngestionService(p, new MemoryStore());
    await expect(service.ingest({ symbol: "BTCUSDT", interval: "1m", startTime: start, endTime: start + minute })).rejects.toThrow();
  });
});
