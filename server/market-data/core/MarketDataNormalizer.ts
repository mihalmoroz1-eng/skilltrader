import type { BinanceInterval, MarketCandle } from "./MarketDataTypes";

export class MarketDataNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataNormalizationError";
  }
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(parsed)) {
    throw new MarketDataNormalizationError(`Invalid Binance field: ${field}`);
  }
  return parsed;
}

/**
 * Converts Binance Spot REST kline rows into the application's canonical candle shape.
 * Binance's response is treated as untrusted external input.
 */
export function normalizeBinanceKlines(
  payload: unknown,
  _symbol: string,
  _interval: BinanceInterval,
): MarketCandle[] {
  if (!Array.isArray(payload)) {
    throw new MarketDataNormalizationError("Binance kline response must be an array");
  }

  return payload.map((row, index) => {
    if (!Array.isArray(row) || row.length < 9) {
      throw new MarketDataNormalizationError(`Malformed Binance kline at index ${index}`);
    }

    return {
      openTime: finiteNumber(row[0], "openTime"),
      open: finiteNumber(row[1], "open"),
      high: finiteNumber(row[2], "high"),
      low: finiteNumber(row[3], "low"),
      close: finiteNumber(row[4], "close"),
      volume: finiteNumber(row[5], "volume"),
      closeTime: finiteNumber(row[6], "closeTime"),
      quoteVolume: finiteNumber(row[7], "quoteVolume"),
      tradeCount: finiteNumber(row[8], "tradeCount"),
    };
  });
}
