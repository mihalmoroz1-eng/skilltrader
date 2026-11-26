import type { FuturesOrderBookLevel } from "./FuturesLiquidityTypes";

export type HistoricalOrderBookSnapshotRecord = {
  symbol: string;
  source: string;
  observedAt: number;
  fetchedAt: number;
  lastUpdateId: number;
  bestBid: string;
  bestAsk: string;
  bidsJson: string;
  asksJson: string;
  bidLevels: number;
  askLevels: number;
  contentDigest: string;
};

export type HistoricalOrderBookSnapshot = {
  symbol: string;
  source: string;
  observedAt: number;
  fetchedAt: number;
  lastUpdateId: number;
  bestBid: string;
  bestAsk: string;
  bids: FuturesOrderBookLevel[];
  asks: FuturesOrderBookLevel[];
  bidLevels: number;
  askLevels: number;
  contentDigest: string;
};

export interface HistoricalOrderBookStore {
  upsert(record: HistoricalOrderBookSnapshotRecord): Promise<void>;
  list(
    symbol: string,
    startTime: number,
    endTime: number,
    limit: number,
  ): Promise<HistoricalOrderBookSnapshotRecord[]>;
  latestAtOrBefore(symbol: string, timestamp: number): Promise<HistoricalOrderBookSnapshotRecord | null>;
}

export type HistoricalOrderBookCaptureResult = {
  symbol: string;
  source: string;
  observedAt: number;
  fetchedAt: number;
  lastUpdateId: number;
  bidLevels: number;
  askLevels: number;
  bestBid: string;
  bestAsk: string;
  spreadBps: number;
  contentDigest: string;
  stored: true;
  executionEligible: false;
  exchangeOrderSent: false;
};

export type HistoricalOrderBookMatchResult = {
  symbol: string;
  decisionTime: number;
  maxAgeMs: number;
  status: "matched" | "missing" | "stale";
  snapshot: HistoricalOrderBookSnapshot | null;
  ageMs: number | null;
  lookAheadPrevented: true;
  executionEligible: false;
  exchangeOrderSent: false;
};
