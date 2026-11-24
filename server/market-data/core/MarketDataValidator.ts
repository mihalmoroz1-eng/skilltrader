import type { MarketCandle } from "./MarketDataTypes";

export class MarketDataValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Market data validation failed: ${issues.join("; ")}`);
    this.name = "MarketDataValidationError";
    this.issues = issues;
  }
}

const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_DECIMAL_LENGTH = 128;

type ScaledDecimal = { coefficient: bigint; scale: number };

function parseDecimal(value: unknown): ScaledDecimal | null {
  if (
    typeof value !== "string" ||
    value.length > MAX_DECIMAL_LENGTH ||
    !DECIMAL_PATTERN.test(value)
  ) {
    return null;
  }

  const [whole, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(whole + fraction),
    scale: fraction.length,
  };
}

function compareDecimals(left: ScaledDecimal, right: ScaledDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const a = left.coefficient * 10n ** BigInt(scale - left.scale);
  const b = right.coefficient * 10n ** BigInt(scale - right.scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function validateCandles(candles: MarketCandle[]): void {
  const issues: string[] = [];

  if (!Array.isArray(candles) || candles.length === 0) {
    throw new MarketDataValidationError(["candle list is empty"]);
  }

  let previousOpenTime: number | null = null;
  candles.forEach((candle, index) => {
    const prefix = `candle[${index}]`;
    if (!candle || typeof candle !== "object") {
      issues.push(`${prefix} must be an object`);
      return;
    }

    const validOpenTime = Number.isSafeInteger(candle.openTime) && candle.openTime >= 0;
    if (!validOpenTime) {
      issues.push(`${prefix}.openTime must be a non-negative safe integer`);
    } else {
      if (previousOpenTime !== null && candle.openTime <= previousOpenTime) {
        issues.push(`${prefix}.openTime is duplicated or out of order`);
      }
      previousOpenTime = candle.openTime;
    }

    if (!Number.isSafeInteger(candle.closeTime) || candle.closeTime < candle.openTime) {
      issues.push(`${prefix}.closeTime must be a safe integer not earlier than openTime`);
    }
    if (!Number.isSafeInteger(candle.tradeCount) || candle.tradeCount < 0) {
      issues.push(`${prefix}.tradeCount must be a non-negative safe integer`);
    }

    const decimals: Partial<Record<"open" | "high" | "low" | "close" | "volume" | "quoteVolume", ScaledDecimal>> = {};
    for (const field of ["open", "high", "low", "close", "volume", "quoteVolume"] as const) {
      const parsed = parseDecimal(candle[field]);
      if (!parsed) {
        issues.push(`${prefix}.${field} must be a plain decimal string of at most ${MAX_DECIMAL_LENGTH} characters`);
      } else {
        decimals[field] = parsed;
      }
    }

    const { open, high, low, close } = decimals;
    if (open && high && low && close) {
      if ([open, high, low, close].some((value) => value.coefficient <= 0n)) {
        issues.push(`${prefix} prices must be positive`);
      }
      if (
        compareDecimals(high, open) < 0 ||
        compareDecimals(high, close) < 0 ||
        compareDecimals(high, low) < 0
      ) {
        issues.push(`${prefix}.high is below an OHLC value`);
      }
      if (
        compareDecimals(low, open) > 0 ||
        compareDecimals(low, close) > 0 ||
        compareDecimals(low, high) > 0
      ) {
        issues.push(`${prefix}.low is above an OHLC value`);
      }
    }
  });

  if (issues.length > 0) throw new MarketDataValidationError(issues);
}
