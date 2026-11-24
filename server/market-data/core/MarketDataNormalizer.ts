import type { MarketCandle } from "./MarketDataTypes";

export class MarketDataNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataNormalizationError";
  }
}

const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function decimalString(value: unknown, field: string): string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new MarketDataNormalizationError(`Invalid Binance decimal field: ${field}`);
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MarketDataNormalizationError(`Invalid Binance integer field: ${field}`);
  }
  return value;
}

/**
 * Converts Binance Spot REST kline tuples into canonical candles.
 * Decimal fields remain strings so exchange precision is not discarded.
 */
export function normalizeBinanceKlines(payload: unknown): MarketCandle[] {
  if (!Array.isArray(payload)) {
    throw new MarketDataNormalizationError("Binance kline response must be an array");
  }

  return payload.map((row, index) => {
    if (!Array.isArray(row) || row.length < 9) {
      throw new MarketDataNormalizationError(`Malformed Binance kline at index ${index}`);
    }

    return {
      openTime: safeInteger(row[0], "openTime"),
      open: decimalString(row[1], "open"),
      high: decimalString(row[2], "high"),
      low: decimalString(row[3], "low"),
      close: decimalString(row[4], "close"),
      volume: decimalString(row[5], "volume"),
      closeTime: safeInteger(row[6], "closeTime"),
      quoteVolume: decimalString(row[7], "quoteVolume"),
      tradeCount: safeInteger(row[8], "tradeCount"),
    };
  });
}
