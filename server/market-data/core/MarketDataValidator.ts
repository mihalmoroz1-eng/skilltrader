import type { MarketCandle } from "./MarketDataTypes";

export class MarketDataValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Market data validation failed: ${issues.join("; ")}`);
    this.name = "MarketDataValidationError";
    this.issues = issues;
  }
}

export function validateCandles(candles: MarketCandle[]): void {
  const issues: string[] = [];

  if (!Array.isArray(candles) || candles.length === 0) {
    throw new MarketDataValidationError(["candle list is empty"]);
  }

  let previousOpenTime = -1;
  candles.forEach((candle, index) => {
    const prefix = `candle[${index}]`;
    const numericFields: (keyof MarketCandle)[] = [
      "openTime", "closeTime", "open", "high", "low", "close",
      "volume", "quoteVolume", "tradeCount",
    ];

    for (const field of numericFields) {
      if (!Number.isFinite(candle[field])) issues.push(`${prefix}.${field} must be finite`);
    }

    if (candle.openTime < 0 || !Number.isInteger(candle.openTime)) {
      issues.push(`${prefix}.openTime must be a non-negative integer`);
    }
    if (candle.closeTime < candle.openTime) {
      issues.push(`${prefix}.closeTime precedes openTime`);
    }
    if ([candle.open, candle.high, candle.low, candle.close].some((value) => value <= 0)) {
      issues.push(`${prefix} prices must be positive`);
    }
    if (candle.volume < 0 || candle.quoteVolume < 0 || candle.tradeCount < 0) {
      issues.push(`${prefix} volume and trade count cannot be negative`);
    }
    if (!Number.isInteger(candle.tradeCount)) {
      issues.push(`${prefix}.tradeCount must be an integer`);
    }
    if (candle.high < Math.max(candle.open, candle.close, candle.low)) {
      issues.push(`${prefix}.high is below an OHLC value`);
    }
    if (candle.low > Math.min(candle.open, candle.close, candle.high)) {
      issues.push(`${prefix}.low is above an OHLC value`);
    }
    if (index > 0 && candle.openTime <= previousOpenTime) {
      issues.push(`${prefix}.openTime is duplicated or out of order`);
    }
    previousOpenTime = candle.openTime;
  });

  if (issues.length > 0) throw new MarketDataValidationError(issues);
}
