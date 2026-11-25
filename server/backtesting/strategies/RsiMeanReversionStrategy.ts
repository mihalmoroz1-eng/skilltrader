import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { calculateRSI } from "../../market-data/core/TechnicalIndicators";
import type { BacktestStrategy, StrategySignalProvider } from "./Strategy";

export type RsiMeanReversionConfig = {
  rsiPeriod: number;
  oversoldLevel: number;
  overboughtLevel: number;
};

/**
 * RSI mean-reversion events are evaluated only after a candle closes.
 * LONG: RSI crosses up through oversold.
 * EXIT: RSI crosses up through overbought (close a LONG).
 * SHORT: RSI crosses down through overbought.
 * EXIT: RSI crosses down through oversold (close a SHORT).
 *
 * The execution layer must fill these events no earlier than the next candle open.
 */
export const rsiMeanReversionStrategy: BacktestStrategy<RsiMeanReversionConfig> = {
  id: "rsi_mean_reversion",

  minimumHistory(config): number {
    validateConfig(config);
    // RSI needs 'period + 1' closes; one further close is needed to detect a crossing.
    // One additional candle is required for the next-open execution boundary.
    return config.rsiPeriod + 3;
  },

  createSignalProvider(
    candles: readonly MarketCandle[],
    config: RsiMeanReversionConfig,
  ): StrategySignalProvider {
    validateConfig(config);
    const closes = candles.map(candle => Number(candle.close));
    const rsi = calculateRSI(closes, config.rsiPeriod);

    return {
      signalAt(closedCandleIndex) {
        if (!Number.isInteger(closedCandleIndex) || closedCandleIndex < 1 ||
            closedCandleIndex >= candles.length) return null;
        const previous = rsi[closedCandleIndex - 1];
        const current = rsi[closedCandleIndex];
        if (previous === null || current === null) return null;

        if (previous <= config.oversoldLevel && current > config.oversoldLevel) return "LONG";
        if (previous < config.overboughtLevel && current >= config.overboughtLevel) return "EXIT";
        if (previous >= config.overboughtLevel && current < config.overboughtLevel) return "SHORT";
        if (previous > config.oversoldLevel && current <= config.oversoldLevel) return "EXIT";
        return null;
      },
    };
  },
};

function validateConfig(config: RsiMeanReversionConfig): void {
  if (!Number.isSafeInteger(config.rsiPeriod) || config.rsiPeriod < 2 || config.rsiPeriod > 100) {
    throw new RangeError("RSI period must be an integer from 2 to 100");
  }
  if (!Number.isFinite(config.oversoldLevel) || config.oversoldLevel < 5 || config.oversoldLevel > 45 ||
      !Number.isFinite(config.overboughtLevel) || config.overboughtLevel < 55 || config.overboughtLevel > 95 ||
      config.overboughtLevel - config.oversoldLevel < 10) {
    throw new RangeError("RSI thresholds are invalid or too close together");
  }
}
