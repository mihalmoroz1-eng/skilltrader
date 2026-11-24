export type NumericCandle = {
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MacdResult = {
  line: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
};

function assertPeriod(period: number): void {
  if (!Number.isSafeInteger(period) || period < 1) {
    throw new RangeError("Indicator period must be a positive safe integer");
  }
}

function assertFiniteValues(values: number[], field: string): void {
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${field}[${index}] must be finite`);
    }
  });
}

function assertCandles(candles: NumericCandle[]): void {
  candles.forEach((candle, index) => {
    if (
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close) ||
      !Number.isFinite(candle.volume) ||
      candle.high <= 0 ||
      candle.low <= 0 ||
      candle.close <= 0 ||
      candle.volume < 0 ||
      candle.high < Math.max(candle.low, candle.close) ||
      candle.low > Math.min(candle.high, candle.close)
    ) {
      throw new RangeError(`candle[${index}] contains invalid OHLCV values`);
    }
  });
}

/**
 * EMA is seeded with an SMA of the first complete period.
 * Earlier indexes are null so warm-up values are never fabricated.
 */
export function calculateEMA(values: number[], period: number): Array<number | null> {
  assertPeriod(period);
  assertFiniteValues(values, "values");

  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return output;

  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index];
  let previous = seed / period;
  output[period - 1] = previous;

  const alpha = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * alpha + previous * (1 - alpha);
    output[index] = previous;
  }

  return output;
}

/**
 * Wilder RSI. The initial average gain/loss uses the first period changes.
 * A flat series returns 50; a gain-only series returns 100.
 */
export function calculateRSI(values: number[], period = 14): Array<number | null> {
  assertPeriod(period);
  assertFiniteValues(values, "values");

  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return output;

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change > 0) averageGain += change;
    else averageLoss -= change;
  }
  averageGain /= period;
  averageLoss /= period;

  const rsiFromAverages = (gain: number, loss: number) => {
    if (loss === 0) return gain === 0 ? 50 : 100;
    if (gain === 0) return 0;
    const relativeStrength = gain / loss;
    return 100 - 100 / (1 + relativeStrength);
  };

  output[period] = rsiFromAverages(averageGain, averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    output[index] = rsiFromAverages(averageGain, averageLoss);
  }

  return output;
}

/**
 * MACD uses EMA(fast) - EMA(slow), with an EMA(signal) over valid MACD values.
 * Default parameters are 12, 26, and 9.
 */
export function calculateMACD(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  assertPeriod(fastPeriod);
  assertPeriod(slowPeriod);
  assertPeriod(signalPeriod);
  if (fastPeriod >= slowPeriod) {
    throw new RangeError("MACD fast period must be smaller than slow period");
  }
  assertFiniteValues(values, "values");

  const fast = calculateEMA(values, fastPeriod);
  const slow = calculateEMA(values, slowPeriod);
  const line: Array<number | null> = values.map((_, index) =>
    fast[index] === null || slow[index] === null ? null : fast[index]! - slow[index]!,
  );

  const firstValidIndex = line.findIndex((value) => value !== null);
  const signal: Array<number | null> = Array(values.length).fill(null);
  const histogram: Array<number | null> = Array(values.length).fill(null);

  if (firstValidIndex >= 0) {
    const validLine = line.slice(firstValidIndex).map((value) => value as number);
    const signalValues = calculateEMA(validLine, signalPeriod);
    for (let offset = 0; offset < signalValues.length; offset += 1) {
      const index = firstValidIndex + offset;
      signal[index] = signalValues[offset];
      if (line[index] !== null && signal[index] !== null) {
        histogram[index] = line[index]! - signal[index]!;
      }
    }
  }

  return { line, signal, histogram };
}

/** Wilder ATR, seeded by the SMA of the first complete set of true ranges. */
export function calculateATR(candles: NumericCandle[], period = 14): Array<number | null> {
  assertPeriod(period);
  assertCandles(candles);

  const output: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length <= period) return output;

  const trueRanges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    ));
  }

  let atr = 0;
  for (let index = 0; index < period; index += 1) atr += trueRanges[index];
  atr /= period;
  output[period] = atr;

  for (let index = period + 1; index < candles.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index - 1]) / period;
    output[index] = atr;
  }

  return output;
}

/**
 * Cumulative VWAP anchored to the first candle in the supplied contiguous
 * segment. It resets when the processor detects a missing candle interval.
 */
export function calculateVWAP(candles: NumericCandle[]): Array<number | null> {
  assertCandles(candles);

  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return candles.map((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null;
  });
}
