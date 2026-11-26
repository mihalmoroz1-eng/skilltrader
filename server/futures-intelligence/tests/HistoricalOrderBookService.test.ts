import { describe, expect, it, vi } from "vitest";
import { FuturesLiquidityService } from "../core/FuturesLiquidityService";
import { HistoricalOrderBookError, HistoricalOrderBookService } from "../core/HistoricalOrderBookService";
import type {
  HistoricalOrderBookSnapshotRecord,
  HistoricalOrderBookStore,
} from "../core/HistoricalOrderBookTypes";
import type { FuturesMarketProvider, FuturesRawSnapshot } from "../core/FuturesLiquidityTypes";

const BASE_TIME = 1_800_000_000_000;
const snapshot: FuturesRawSnapshot = {
  symbol: "BTCUSDT", source: "binance-usdm-futures", fetchedAt: BASE_TIME,
  orderBook: {
    lastUpdateId: 1234,
    bids: [{ price: "100", quantity: "5" }, { price: "99.9", quantity: "8" }],
    asks: [{ price: "100.1", quantity: "4" }, { price: "100.2", quantity: "7" }],
  },
  markPrice: "100.05", indexPrice: "100", fundingRate: "0.0001",
  nextFundingTime: BASE_TIME + 28_800_000, openInterest: "12000",
};

class MemoryStore implements HistoricalOrderBookStore {
  rows: HistoricalOrderBookSnapshotRecord[] = [];
  async upsert(record: HistoricalOrderBookSnapshotRecord) {
    const index = this.rows.findIndex(row => row.symbol === record.symbol &&
      row.observedAt === record.observedAt && row.lastUpdateId === record.lastUpdateId);
    if (index >= 0) this.rows[index] = record;
    else this.rows.push(record);
  }
  async list(symbol: string, startTime: number, endTime: number, limit: number) {
    return this.rows.filter(row => row.symbol === symbol && row.observedAt >= startTime &&
      row.observedAt <= endTime).sort((a, b) => a.observedAt - b.observedAt).slice(0, limit);
  }
  async latestAtOrBefore(symbol: string, timestamp: number) {
    return this.rows.filter(row => row.symbol === symbol && row.observedAt <= timestamp)
      .sort((a, b) => b.observedAt - a.observedAt)[0] ?? null;
  }
}
function fixture(options: { fetchedAt?: number; observedAt?: number; raw?: FuturesRawSnapshot } = {}) {
  const raw = options.raw ?? { ...snapshot, fetchedAt: options.fetchedAt ?? BASE_TIME };
  const provider: FuturesMarketProvider = {
    id: "binance-usdm-futures",
    fetchSnapshot: vi.fn(async () => raw),
  };
  const store = new MemoryStore();
  const liquidity = new FuturesLiquidityService(provider, () => options.observedAt ?? raw.fetchedAt);
  const service = new HistoricalOrderBookService(
    provider, liquidity, store, () => options.observedAt ?? raw.fetchedAt,
  );
  return { provider, store, service };
}

describe("Historical Order Book Intelligence", () => {
  it("captures validated visible depth with receipt time and digest", async () => {
    const { service, store } = fixture({ observedAt: BASE_TIME + 25 });
    const result = await service.capture("BTCUSDT", 100);
    expect(result.stored).toBe(true);
    expect(result.observedAt).toBe(BASE_TIME + 25);
    expect(result.bidLevels).toBe(2);
    expect(result.askLevels).toBe(2);
    expect(result.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].bidsJson).toContain('"100"');
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
  });

  it("rejects stale snapshots and does not persist them", async () => {
    const { service, store } = fixture({ observedAt: BASE_TIME + 30_001 });
    await expect(service.capture("BTCUSDT")).rejects.toThrow(/stale/);
    expect(store.rows).toHaveLength(0);
  });

  it("rejects provider symbol mismatch and malformed order books", async () => {
    const wrongSymbol = { ...snapshot, symbol: "ETHUSDT" };
    const wrong = fixture({ raw: wrongSymbol });
    await expect(wrong.service.capture("BTCUSDT")).rejects.toThrow();
    const crossed = {
      ...snapshot,
      orderBook: { ...snapshot.orderBook, bids: [{ price: "101", quantity: "1" }] },
    };
    const bad = fixture({ raw: crossed });
    await expect(bad.service.capture("BTCUSDT")).rejects.toThrow();
  });

  it("returns only a snapshot observed at or before the decision time", async () => {
    const { service, store } = fixture({ observedAt: BASE_TIME + 100 });
    await service.capture("BTCUSDT");
    const before = await service.matchAtOrBefore("BTCUSDT", BASE_TIME + 99);
    expect(before.status).toBe("missing");
    expect(before.snapshot).toBeNull();
    const at = await service.matchAtOrBefore("BTCUSDT", BASE_TIME + 100);
    expect(at.status).toBe("matched");
    expect(at.snapshot?.observedAt).toBe(BASE_TIME + 100);
    expect(at.ageMs).toBe(0);
    expect(at.lookAheadPrevented).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("selects the newest eligible snapshot and marks stale observations", async () => {
    const first = fixture({ observedAt: BASE_TIME + 100 });
    await first.service.capture("BTCUSDT");
    const secondRaw = { ...snapshot, fetchedAt: BASE_TIME + 1_000,
      orderBook: { ...snapshot.orderBook, lastUpdateId: 1235 } };
    const secondProvider: FuturesMarketProvider = {
      id: "binance-usdm-futures", fetchSnapshot: vi.fn(async () => secondRaw),
    };
    const secondService = new HistoricalOrderBookService(
      secondProvider, new FuturesLiquidityService(secondProvider, () => BASE_TIME + 1_000),
      first.store, () => BASE_TIME + 1_000,
    );
    await secondService.capture("BTCUSDT");
    const latest = await secondService.matchAtOrBefore("BTCUSDT", BASE_TIME + 2_000, 2_000);
    expect(latest.snapshot?.lastUpdateId).toBe(1235);
    expect(latest.status).toBe("matched");
    const stale = await secondService.matchAtOrBefore("BTCUSDT", BASE_TIME + 40_000, 1_000);
    expect(stale.status).toBe("stale");
  });

  it("verifies stored content digest before returning history or a matched snapshot", async () => {
    const { service, store } = fixture();
    await service.capture("BTCUSDT");
    store.rows[0].asksJson = JSON.stringify([{ price: "100.2", quantity: "99" }]);
    await expect(service.history("BTCUSDT", BASE_TIME, BASE_TIME + 1000)).rejects.toThrow(/digest/);
    await expect(service.matchAtOrBefore("BTCUSDT", BASE_TIME)).rejects.toThrow(/digest/);
  });

  it("rejects invalid ranges, limits and decision timestamps", async () => {
    const { service } = fixture();
    await expect(service.history("BTCUSDT", BASE_TIME, BASE_TIME)).rejects.toThrow(HistoricalOrderBookError);
    await expect(service.history("BTCUSDT", BASE_TIME, BASE_TIME + 1, 5001)).rejects.toThrow(HistoricalOrderBookError);
    await expect(service.matchAtOrBefore("BTCUSDT", -1)).rejects.toThrow(HistoricalOrderBookError);
    await expect(service.capture("BTC/USDT")).rejects.toThrow(HistoricalOrderBookError);
  });
});
