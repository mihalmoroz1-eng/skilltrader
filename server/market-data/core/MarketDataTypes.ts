export const BINANCE_INTERVALS = [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
] as const;

export type BinanceInterval = (typeof BINANCE_INTERVALS)[number];

export type MarketCandle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
};

export type MarketDataSnapshot = {
  symbol: string;
  interval: BinanceInterval;
  source: "binance-spot";
  fetchedAt: number;
  freshness: "live";
  candles: MarketCandle[];
};

export interface MarketDataProvider {
  readonly id: MarketDataSnapshot["source"];
  fetchCandles(
    symbol: string,
    interval: BinanceInterval,
    limit: number,
  ): Promise<unknown>;
}

export function isBinanceInterval(value: string): value is BinanceInterval {
  return (BINANCE_INTERVALS as readonly string[]).includes(value);
}
