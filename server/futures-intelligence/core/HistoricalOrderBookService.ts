import { createHash } from "node:crypto";
import type { FuturesLiquidityService } from "./FuturesLiquidityService";
import type { FuturesMarketProvider, FuturesOrderBookLevel } from "./FuturesLiquidityTypes";
import type {
  HistoricalOrderBookCaptureResult,
  HistoricalOrderBookMatchResult,
  HistoricalOrderBookSnapshot,
  HistoricalOrderBookSnapshotRecord,
  HistoricalOrderBookStore,
} from "./HistoricalOrderBookTypes";

export class HistoricalOrderBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalOrderBookError";
  }
}

const MAX_SNAPSHOT_AGE_MS = 30_000;
const MAX_HISTORY_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function validateSymbol(value: string): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{2,20}$/.test(value)) {
    throw new HistoricalOrderBookError("Invalid symbol");
  }
  return value;
}

function digestSnapshot(input: {
  symbol: string;
  source: string;
  observedAt: number;
  fetchedAt: number;
  lastUpdateId: number;
  bids: FuturesOrderBookLevel[];
  asks: FuturesOrderBookLevel[];
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function parseAndVerify(record: HistoricalOrderBookSnapshotRecord): HistoricalOrderBookSnapshot {
  let bids: FuturesOrderBookLevel[];
  let asks: FuturesOrderBookLevel[];
  try {
    bids = JSON.parse(record.bidsJson) as FuturesOrderBookLevel[];
    asks = JSON.parse(record.asksJson) as FuturesOrderBookLevel[];
  } catch {
    throw new HistoricalOrderBookError("Stored order-book JSON is corrupt");
  }
  if (!/^[A-Z0-9]{2,20}$/.test(record.symbol) || typeof record.source !== "string" ||
      !record.source.trim() || record.source.length > 40 ||
      !Array.isArray(bids) || !Array.isArray(asks) ||
      bids.length !== record.bidLevels || asks.length !== record.askLevels ||
      bids.length < 1 || asks.length < 1 || bids.length > 1000 || asks.length > 1000 ||
      !Number.isSafeInteger(record.observedAt) || !Number.isSafeInteger(record.fetchedAt) ||
      record.observedAt < record.fetchedAt || !Number.isSafeInteger(record.lastUpdateId) ||
      record.lastUpdateId < 0 || !record.source || !/^[a-f0-9]{64}$/.test(record.contentDigest)) {
    throw new HistoricalOrderBookError("Stored order-book metadata is invalid");
  }
  const validSide = (levels: FuturesOrderBookLevel[], side: "bid" | "ask") => {
    let previous: number | null = null;
    for (const level of levels) {
      if (!level || typeof level.price !== "string" || typeof level.quantity !== "string" ||
          !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(level.price) ||
          !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(level.quantity)) {
        throw new HistoricalOrderBookError("Stored order-book level is invalid");
      }
      const price = Number(level.price);
      const quantity = Number(level.quantity);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0 ||
          (previous !== null && (side === "bid" ? price > previous : price < previous))) {
        throw new HistoricalOrderBookError("Stored order-book levels are malformed or unsorted");
      }
      previous = price;
    }
  };
  validSide(bids, "bid");
  validSide(asks, "ask");
  if (Number(bids[0].price) >= Number(asks[0].price) ||
      bids[0].price !== record.bestBid || asks[0].price !== record.bestAsk) {
    throw new HistoricalOrderBookError("Stored order book is crossed or best quotes do not match");
  }
  const expectedDigest = digestSnapshot({
    symbol: record.symbol, source: record.source, observedAt: record.observedAt,
    fetchedAt: record.fetchedAt, lastUpdateId: record.lastUpdateId, bids, asks,
  });
  if (expectedDigest !== record.contentDigest) {
    throw new HistoricalOrderBookError("Stored order-book digest does not match its contents");
  }
  return {
    symbol: record.symbol, source: record.source, observedAt: record.observedAt,
    fetchedAt: record.fetchedAt, lastUpdateId: record.lastUpdateId,
    bestBid: record.bestBid, bestAsk: record.bestAsk, bids, asks,
    bidLevels: record.bidLevels, askLevels: record.askLevels,
    contentDigest: record.contentDigest,
  };
}

export class HistoricalOrderBookService {
  constructor(
    private readonly provider: FuturesMarketProvider,
    private readonly liquidity: FuturesLiquidityService,
    private readonly store: HistoricalOrderBookStore,
    private readonly now: () => number = Date.now,
  ) {
    if (!provider?.id?.trim()) throw new Error("Historical order-book provider is required");
  }

  async capture(symbolInput: string, depthLimit = 100): Promise<HistoricalOrderBookCaptureResult> {
    const symbol = validateSymbol(symbolInput);
    if (!Number.isInteger(depthLimit) || depthLimit < 5 || depthLimit > 1000) {
      throw new HistoricalOrderBookError("Depth limit must be from 5 to 1000");
    }
    const snapshot = await this.provider.fetchSnapshot(symbol, depthLimit);
    const analysis = this.liquidity.analyzeSnapshot(snapshot, depthLimit);
    if (snapshot.symbol !== symbol) throw new HistoricalOrderBookError("Provider snapshot symbol does not match request");
    const observedAt = this.now();
    if (!Number.isSafeInteger(observedAt) || observedAt < snapshot.fetchedAt ||
        observedAt - snapshot.fetchedAt > MAX_SNAPSHOT_AGE_MS) {
      throw new HistoricalOrderBookError("Snapshot is stale or has an invalid observation timestamp");
    }
    const payload = {
      symbol, source: snapshot.source, observedAt, fetchedAt: snapshot.fetchedAt,
      lastUpdateId: snapshot.orderBook.lastUpdateId,
      bids: snapshot.orderBook.bids, asks: snapshot.orderBook.asks,
    };
    const contentDigest = digestSnapshot(payload);
    await this.store.upsert({
      symbol, source: snapshot.source, observedAt, fetchedAt: snapshot.fetchedAt,
      lastUpdateId: snapshot.orderBook.lastUpdateId,
      bestBid: analysis.orderBook.bestBid, bestAsk: analysis.orderBook.bestAsk,
      bidsJson: JSON.stringify(snapshot.orderBook.bids),
      asksJson: JSON.stringify(snapshot.orderBook.asks),
      bidLevels: snapshot.orderBook.bids.length, askLevels: snapshot.orderBook.asks.length,
      contentDigest,
    });
    return {
      symbol, source: snapshot.source, observedAt, fetchedAt: snapshot.fetchedAt,
      lastUpdateId: snapshot.orderBook.lastUpdateId,
      bidLevels: snapshot.orderBook.bids.length, askLevels: snapshot.orderBook.asks.length,
      bestBid: analysis.orderBook.bestBid, bestAsk: analysis.orderBook.bestAsk,
      spreadBps: analysis.orderBook.spreadBps, contentDigest,
      stored: true, executionEligible: false, exchangeOrderSent: false,
    };
  }

  async history(symbolInput: string, startTime: number, endTime: number, limit = 500) {
    const symbol = validateSymbol(symbolInput);
    if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) ||
        startTime < 0 || endTime <= startTime || endTime - startTime > MAX_HISTORY_RANGE_MS ||
        !Number.isInteger(limit) || limit < 1 || limit > 5000) {
      throw new HistoricalOrderBookError("Invalid historical order-book range or limit");
    }
    const rows = await this.store.list(symbol, startTime, endTime, limit + 1);
    const truncated = rows.length > limit;
    const snapshots = rows.slice(0, limit).map(parseAndVerify);
    if (snapshots.some(snapshot => snapshot.symbol !== symbol)) {
      throw new HistoricalOrderBookError("Historical order-book store returned a different symbol");
    }
    for (let i = 1; i < snapshots.length; i += 1) {
      if (snapshots[i].observedAt <= snapshots[i - 1].observedAt) {
        throw new HistoricalOrderBookError("Historical order-book timestamps are not strictly increasing");
      }
    }
    return {
      symbol, requested: { startTime, endTime }, returned: snapshots.length,
      truncated, snapshots,
      executionEligible: false as const, exchangeOrderSent: false as const,
    };
  }

  async matchAtOrBefore(
    symbolInput: string,
    decisionTime: number,
    maxAgeMs = MAX_SNAPSHOT_AGE_MS,
  ): Promise<HistoricalOrderBookMatchResult> {
    const symbol = validateSymbol(symbolInput);
    if (!Number.isSafeInteger(decisionTime) || decisionTime < 0 ||
        !Number.isInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 300_000) {
      throw new HistoricalOrderBookError("Invalid historical order-book match request");
    }
    const row = await this.store.latestAtOrBefore(symbol, decisionTime);
    if (!row) {
      return {
        symbol, decisionTime, maxAgeMs, status: "missing", snapshot: null, ageMs: null,
        lookAheadPrevented: true, executionEligible: false, exchangeOrderSent: false,
      };
    }
    const snapshot = parseAndVerify(row);
    if (snapshot.symbol !== symbol) throw new HistoricalOrderBookError("Historical order-book store returned a different symbol");
    const ageMs = decisionTime - snapshot.observedAt;
    return {
      symbol, decisionTime, maxAgeMs,
      status: ageMs <= maxAgeMs ? "matched" : "stale",
      snapshot, ageMs, lookAheadPrevented: true,
      executionEligible: false, exchangeOrderSent: false,
    };
  }
}
