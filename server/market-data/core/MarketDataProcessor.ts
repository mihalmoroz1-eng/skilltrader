import { isMarketInterval, type MarketCandle, type MarketDataSnapshot, type MarketInterval } from "./MarketDataTypes";
import { validateCandles } from "./MarketDataValidator";
import {
  calculateATR,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateVWAP,
  type NumericCandle,
} from "./TechnicalIndicators";

export type IndicatorPoint = {
  openTime: number;
  closeTime: number;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr14: number | null;
  vwap: number | null;
};

export type MarketDataGap = {
  afterOpenTime: number;
  beforeOpenTime: number;
  missingIntervals: number | null;
};

export type MarketDataQuality = {
  status: "ready" | "degraded" | "insufficient";
  inputCandleCount: number;
  closedCandleCount: number;
  incompleteCandleCount: number;
  gapCount: number;
  estimatedMissingIntervals: number | null;
  continuousSegments: number;
  longestContinuousSegment: number;
  minimumCandlesForFullIndicators: number;
  gaps: MarketDataGap[];
  warnings: string[];
};

export type ProcessedMarketData = MarketDataSnapshot & {
  processedAt: number;
  quality: MarketDataQuality;
  indicators: IndicatorPoint[];
};

export class MarketDataProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataProcessingError";
  }
}

const MINIMUM_CANDLES_FOR_FULL_INDICATORS = 50;
const MAX_PROCESSABLE_CANDLES = 1_000;

function fixedIntervalMs(interval: MarketInterval): number | null {
  const intervals: Partial<Record<MarketInterval, number>> = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
    "3d": 259_200_000,
    "1w": 604_800_000,
  };
  return intervals[interval] ?? null;
}

function expectedNextOpenTime(openTime: number, interval: MarketInterval): number {
  if (interval === "1M") {
    const date = new Date(openTime);
    if (!Number.isFinite(date.getTime())) {
      throw new MarketDataProcessingError("Candle open time is outside the supported calendar range");
    }
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }

  const intervalMs = fixedIntervalMs(interval);
  if (intervalMs === null) {
    throw new MarketDataProcessingError("Unsupported interval for deterministic processing");
  }
  return openTime + intervalMs;
}

function estimateMissingIntervals(
  previousOpenTime: number,
  currentOpenTime: number,
  interval: MarketInterval,
): number | null {
  if (interval === "1M") {
    const previous = new Date(previousOpenTime);
    const current = new Date(currentOpenTime);
    if (!Number.isFinite(previous.getTime()) || !Number.isFinite(current.getTime())) return null;
    const previousAligned = previous.getUTCDate() === 1 &&
      previous.getUTCHours() === 0 &&
      previous.getUTCMinutes() === 0 &&
      previous.getUTCSeconds() === 0 &&
      previous.getUTCMilliseconds() === 0;
    const currentAligned = current.getUTCDate() === 1 &&
      current.getUTCHours() === 0 &&
      current.getUTCMinutes() === 0 &&
      current.getUTCSeconds() === 0 &&
      current.getUTCMilliseconds() === 0;
    if (!previousAligned || !currentAligned) return null;
    const monthDelta =
      (current.getUTCFullYear() - previous.getUTCFullYear()) * 12 +
      current.getUTCMonth() - previous.getUTCMonth();
    return monthDelta > 1 ? monthDelta - 1 : null;
  }

  const intervalMs = fixedIntervalMs(interval);
  if (intervalMs === null) return null;
  const delta = currentOpenTime - previousOpenTime;
  if (delta <= intervalMs || delta % intervalMs !== 0) return null;
  return delta / intervalMs - 1;
}

function toNumericCandle(candle: MarketCandle, index: number): NumericCandle {
  const numeric: NumericCandle = {
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume),
  };
  if (
    !Number.isFinite(numeric.high) ||
    !Number.isFinite(numeric.low) ||
    !Number.isFinite(numeric.close) ||
    !Number.isFinite(numeric.volume)
  ) {
    throw new MarketDataProcessingError(`candle[${index}] cannot be represented safely for indicator calculations`);
  }
  return numeric;
}

function calculateSegmentIndicators(
  segment: MarketCandle[],
  offset: number,
  output: Array<IndicatorPoint | undefined>,
): void {
  const numericCandles = segment.map((candle, index) => toNumericCandle(candle, offset + index));
  const closes = numericCandles.map((candle) => candle.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const atr14 = calculateATR(numericCandles, 14);
  const vwap = calculateVWAP(numericCandles);

  segment.forEach((candle, index) => {
    output[offset + index] = {
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      ema20: ema20[index],
      ema50: ema50[index],
      rsi14: rsi14[index],
      macdLine: macd.line[index],
      macdSignal: macd.signal[index],
      macdHistogram: macd.histogram[index],
      atr14: atr14[index],
      vwap: vwap[index],
    };
  });
}

/**
 * Processes only closed candles. Missing intervals split the data into
 * independent segments so recursive indicators never bridge a data gap.
 * Raw exchange decimals remain untouched in the returned candles.
 */
export function processMarketData(
  snapshot: MarketDataSnapshot,
  processedAt = Date.now(),
): ProcessedMarketData {
  if (!snapshot || typeof snapshot !== "object") {
    throw new MarketDataProcessingError("Market data snapshot is required");
  }
  if (!isMarketInterval(snapshot.interval)) {
    throw new MarketDataProcessingError("Snapshot contains an unsupported interval");
  }
  if (typeof snapshot.symbol !== "string" || !/^[A-Z0-9]{2,20}$/.test(snapshot.symbol)) {
    throw new MarketDataProcessingError("Snapshot contains an invalid symbol");
  }
  if (typeof snapshot.source !== "string" || snapshot.source.trim().length === 0) {
    throw new MarketDataProcessingError("Snapshot source metadata is missing");
  }
  if (!Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt < 0) {
    throw new MarketDataProcessingError("Snapshot fetch timestamp is invalid");
  }
  if (snapshot.freshness !== "live" && snapshot.freshness !== "cached") {
    throw new MarketDataProcessingError("Snapshot freshness metadata is invalid");
  }
  if (!Number.isSafeInteger(processedAt) || processedAt < 0) {
    throw new MarketDataProcessingError("Processing timestamp must be a non-negative safe integer");
  }
  if (!Array.isArray(snapshot.candles) || snapshot.candles.length === 0) {
    throw new MarketDataProcessingError("Snapshot does not contain candles");
  }
  if (snapshot.candles.length > MAX_PROCESSABLE_CANDLES) {
    throw new MarketDataProcessingError(`Snapshot exceeds the ${MAX_PROCESSABLE_CANDLES}-candle processing limit`);
  }

  validateCandles(snapshot.candles);
  snapshot.candles.forEach((candle, index) => {
    if (candle.openTime > processedAt) {
      throw new MarketDataProcessingError(`candle[${index}] is dated in the future`);
    }
    const expectedCloseTime = expectedNextOpenTime(candle.openTime, snapshot.interval) - 1;
    if (candle.closeTime !== expectedCloseTime) {
      throw new MarketDataProcessingError(`candle[${index}] close time does not match the requested interval`);
    }
  });

  const closedCandles = snapshot.candles.filter((candle) => candle.closeTime < processedAt);
  const incompleteCandleCount = snapshot.candles.length - closedCandles.length;
  const gaps: MarketDataGap[] = [];
  const segments: Array<{ start: number; end: number }> = [];

  if (closedCandles.length > 0) {
    let segmentStart = 0;
    for (let index = 1; index < closedCandles.length; index += 1) {
      const previous = closedCandles[index - 1];
      const current = closedCandles[index];
      const expectedOpen = expectedNextOpenTime(previous.openTime, snapshot.interval);

      if (current.openTime !== expectedOpen) {
        gaps.push({
          afterOpenTime: previous.openTime,
          beforeOpenTime: current.openTime,
          missingIntervals: estimateMissingIntervals(previous.openTime, current.openTime, snapshot.interval),
        });
        segments.push({ start: segmentStart, end: index });
        segmentStart = index;
      }
    }
    segments.push({ start: segmentStart, end: closedCandles.length });
  }

  const indicators: Array<IndicatorPoint | undefined> = Array(closedCandles.length);
  for (const segment of segments) {
    calculateSegmentIndicators(
      closedCandles.slice(segment.start, segment.end),
      segment.start,
      indicators,
    );
  }

  const longestContinuousSegment = segments.reduce(
    (longest, segment) => Math.max(longest, segment.end - segment.start),
    0,
  );
  const estimatedMissingIntervals = gaps.some((gap) => gap.missingIntervals === null)
    ? null
    : gaps.reduce((total, gap) => total + (gap.missingIntervals ?? 0), 0);
  const status: MarketDataQuality["status"] = longestContinuousSegment < MINIMUM_CANDLES_FOR_FULL_INDICATORS
    ? "insufficient"
    : gaps.length > 0
      ? "degraded"
      : "ready";
  const warnings: string[] = [];

  if (incompleteCandleCount > 0) {
    warnings.push("Unclosed candles were excluded from indicator calculations.");
  }
  if (gaps.length > 0) {
    warnings.push("Missing intervals split the series; indicators were reset after each gap.");
  }
  if (longestContinuousSegment < MINIMUM_CANDLES_FOR_FULL_INDICATORS) {
    warnings.push(`At least ${MINIMUM_CANDLES_FOR_FULL_INDICATORS} consecutive closed candles are required for the full EMA 50 set.`);
  }

  return {
    ...snapshot,
    processedAt,
    quality: {
      status,
      inputCandleCount: snapshot.candles.length,
      closedCandleCount: closedCandles.length,
      incompleteCandleCount,
      gapCount: gaps.length,
      estimatedMissingIntervals,
      continuousSegments: segments.length,
      longestContinuousSegment,
      minimumCandlesForFullIndicators: MINIMUM_CANDLES_FOR_FULL_INDICATORS,
      gaps,
      warnings,
    },
    indicators: indicators.filter((point): point is IndicatorPoint => point !== undefined),
  };
}
