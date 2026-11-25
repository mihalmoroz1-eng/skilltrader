import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";

export type CanonicalMarketRegime =
  | "uptrend"
  | "downtrend"
  | "ranging"
  | "high_volatility"
  | "transition";

export type CanonicalMarketRegimeConfig = {
  interval: MarketInterval;
  lookback: number;
  trendThresholdBps: number;
  rangeThresholdBps: number;
  highVolatilityThresholdBps: number;
};

export type CanonicalMarketRegimeMetrics = {
  regime: CanonicalMarketRegime;
  confidence: number;
  netChangeBps: number;
  efficiencyRatio: number;
  averageTrueRangeBps: number;
};

export class MarketRegimeClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketRegimeClassificationError";
  }
}

const FIXED_INTERVAL_MS: Partial<Record<MarketInterval, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
  "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000,
  "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

function intervalStep(interval: MarketInterval, openTime: number): number {
  if (interval === "1M") {
    const date = new Date(openTime);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - openTime;
  }
  return FIXED_INTERVAL_MS[interval] ?? 0;
}

function finitePositive(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new MarketRegimeClassificationError(`Candle contains an invalid ${label}`);
  }
  return parsed;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new MarketRegimeClassificationError(`Non-finite ${label}; classification was withheld`);
  }
  return value;
}

export function classifyMarketRegimeWindow(
  candles: MarketCandle[],
  config: CanonicalMarketRegimeConfig,
): CanonicalMarketRegimeMetrics {
  if (!Number.isInteger(config.lookback) || config.lookback < 10 || config.lookback > 200 ||
      !Number.isInteger(config.trendThresholdBps) || config.trendThresholdBps <= 0 ||
      !Number.isInteger(config.rangeThresholdBps) || config.rangeThresholdBps <= 0 ||
      !Number.isInteger(config.highVolatilityThresholdBps) || config.highVolatilityThresholdBps <= 0 ||
      config.rangeThresholdBps >= config.trendThresholdBps) {
    throw new MarketRegimeClassificationError("Regime lookback or thresholds are invalid");
  }
  if (candles.length !== config.lookback + 1) {
    throw new MarketRegimeClassificationError("A regime window must contain exactly lookback + 1 candles");
  }

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!Number.isSafeInteger(candle.openTime) || !Number.isSafeInteger(candle.closeTime)) {
      throw new MarketRegimeClassificationError("Candle timestamps are invalid");
    }
    const open = finitePositive(candle.open, "open price");
    const high = finitePositive(candle.high, "high price");
    const low = finitePositive(candle.low, "low price");
    const close = finitePositive(candle.close, "close price");
    if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
      throw new MarketRegimeClassificationError("Candle OHLC relationship is invalid");
    }
    const step = intervalStep(config.interval, candle.openTime);
    if (step <= 0 || candle.closeTime !== candle.openTime + step - 1) {
      throw new MarketRegimeClassificationError("Candle close time does not match the selected interval");
    }
    if (index > 0) {
      const previous = candles[index - 1];
      const expectedOpen = previous.openTime + intervalStep(config.interval, previous.openTime);
      if (candle.openTime !== expectedOpen || candle.openTime <= previous.openTime) {
        throw new MarketRegimeClassificationError("Regime window contains a gap, duplicate or misaligned candle");
      }
    }
  }

  const firstClose = finitePositive(candles[0].close, "close price");
  const lastClose = finitePositive(candles[candles.length - 1].close, "close price");
  const netChangeBps = finite((lastClose / firstClose - 1) * 10_000, "net change");
  let pathLengthBps = 0;
  let trueRangeTotalBps = 0;

  for (let index = 1; index < candles.length; index += 1) {
    const previousClose = finitePositive(candles[index - 1].close, "close price");
    const close = finitePositive(candles[index].close, "close price");
    const high = finitePositive(candles[index].high, "high price");
    const low = finitePositive(candles[index].low, "low price");
    pathLengthBps = finite(
      pathLengthBps + Math.abs(close / previousClose - 1) * 10_000,
      "price path",
    );
    trueRangeTotalBps = finite(
      trueRangeTotalBps +
        Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)) /
          previousClose * 10_000,
      "true range",
    );
  }

  const efficiencyRatio = pathLengthBps > 0
    ? finite(Math.min(1, Math.abs(netChangeBps) / pathLengthBps), "efficiency ratio")
    : 0;
  const averageTrueRangeBps = finite(trueRangeTotalBps / config.lookback, "average true range");

  let regime: CanonicalMarketRegime;
  let confidence: number;
  if (averageTrueRangeBps >= config.highVolatilityThresholdBps) {
    regime = "high_volatility";
    confidence = Math.min(
      100,
      50 + (averageTrueRangeBps / config.highVolatilityThresholdBps - 1) * 25,
    );
  } else if (netChangeBps >= config.trendThresholdBps && efficiencyRatio >= 0.35) {
    regime = "uptrend";
    confidence = Math.min(
      100,
      50 + Math.min(netChangeBps / config.trendThresholdBps - 1, efficiencyRatio) * 25,
    );
  } else if (netChangeBps <= -config.trendThresholdBps && efficiencyRatio >= 0.35) {
    regime = "downtrend";
    confidence = Math.min(
      100,
      50 + Math.min(Math.abs(netChangeBps) / config.trendThresholdBps - 1, efficiencyRatio) * 25,
    );
  } else if (Math.abs(netChangeBps) <= config.rangeThresholdBps && efficiencyRatio <= 0.25) {
    regime = "ranging";
    confidence = Math.min(100, 50 + (1 - efficiencyRatio) * 25);
  } else {
    regime = "transition";
    confidence = 50;
  }

  return {
    regime,
    confidence: Math.round(finite(confidence, "rule strength") * 100) / 100,
    netChangeBps: Math.round(netChangeBps * 100) / 100,
    efficiencyRatio: Math.round(efficiencyRatio * 10_000) / 10_000,
    averageTrueRangeBps: Math.round(averageTrueRangeBps * 100) / 100,
  };
}
