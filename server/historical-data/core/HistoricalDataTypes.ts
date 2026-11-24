import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";

export type HistoricalRange = {
  symbol: string;
  interval: MarketInterval;
  startTime: number;
  endTime: number;
  pageLimit?: number;
};

export type HistoricalCandleRecord = MarketCandle & {
  symbol: string;
  interval: MarketInterval;
  source: string;
  fetchedAt: number;
};

export type HistoricalDataQuality = {
  requested: { startTime: number; endTime: number };
  returned: number;
  duplicatesRemoved: number;
  gaps: Array<{ previousOpenTime: number; nextOpenTime: number; expectedNextOpenTime: number }>;
  firstOpenTime: number | null;
  lastOpenTime: number | null;
  complete: boolean;
};

export type HistoricalIngestionResult = {
  symbol: string;
  interval: MarketInterval;
  source: string;
  fetchedAt: number;
  candlesStored: number;
  pagesFetched: number;
  quality: HistoricalDataQuality;
};

export interface HistoricalCandleProvider {
  readonly id: string;
  fetchCandles(
    symbol: string,
    interval: MarketInterval,
    startTime: number,
    endTime: number,
    limit: number,
  ): Promise<MarketCandle[]>;
}

export interface HistoricalCandleStore {
  upsert(records: HistoricalCandleRecord[]): Promise<void>;
  list(
    symbol: string,
    interval: MarketInterval,
    startTime: number,
    endTime: number,
    limit: number,
  ): Promise<HistoricalCandleRecord[]>;
}
