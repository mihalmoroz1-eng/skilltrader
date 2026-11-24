export const MARKET_INTERVALS = [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
] as const;

export type MarketInterval = (typeof MARKET_INTERVALS)[number];
export type DecimalString = string;

export type MarketCandle = {
  openTime: number;
  closeTime: number;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  volume: DecimalString;
  quoteVolume: DecimalString;
  tradeCount: number;
};

export type MarketDataSnapshot = {
  symbol: string;
  interval: MarketInterval;
  source: string;
  fetchedAt: number;
  freshness: "live" | "cached";
  candles: MarketCandle[];
};

/** Provider-specific parsing stays inside each adapter. */
export interface MarketDataProvider {
  readonly id: string;
  fetchCandles(symbol: string, interval: MarketInterval, limit: number): Promise<MarketCandle[]>;
}

export function isMarketInterval(value: string): value is MarketInterval {
  return (MARKET_INTERVALS as readonly string[]).includes(value);
}
