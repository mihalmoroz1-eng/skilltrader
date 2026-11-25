import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import type { BacktestStrategy, StrategySignalProvider } from "./Strategy";

export type BreakoutConfig = {
  lookbackPeriod: number;
  breakoutBufferBps: number;
};

/**
 * Close-confirmed range breakout.
 * The current candle must close beyond the highest high / lowest low of the
 * preceding lookback window, plus a configurable buffer. Wicks alone never
 * trigger an entry. The shared executor fills at the next candle open.
 */
export const breakoutStrategy: BacktestStrategy<BreakoutConfig> = {
  id: "breakout",

  minimumHistory(config): number {
    validateConfig(config);
    // The executor asks for a signal one candle before the fill candle.
    return config.lookbackPeriod + 2;
  },

  createSignalProvider(
    candles: readonly MarketCandle[],
    config: BreakoutConfig,
  ): StrategySignalProvider {
    validateConfig(config);

    return {
      signalAt(closedCandleIndex) {
        if (!Number.isInteger(closedCandleIndex) || closedCandleIndex < config.lookbackPeriod ||
            closedCandleIndex >= candles.length) return null;

        const currentClose = Number(candles[closedCandleIndex].close);
        if (!Number.isFinite(currentClose) || currentClose <= 0) return null;

        let highestHigh = Number.NEGATIVE_INFINITY;
        let lowestLow = Number.POSITIVE_INFINITY;
        const start = closedCandleIndex - config.lookbackPeriod;
        for (let index = start; index < closedCandleIndex; index += 1) {
          const high = Number(candles[index].high);
          const low = Number(candles[index].low);
          if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0 || high < low) return null;
          highestHigh = Math.max(highestHigh, high);
          lowestLow = Math.min(lowestLow, low);
        }

        const bufferRate = config.breakoutBufferBps / 10_000;
        if (currentClose > highestHigh * (1 + bufferRate)) return "LONG";
        if (currentClose < lowestLow * (1 - bufferRate)) return "SHORT";
        return null;
      },
    };
  },
};

function validateConfig(config: BreakoutConfig): void {
  if (!Number.isSafeInteger(config.lookbackPeriod) || config.lookbackPeriod < 2 || config.lookbackPeriod > 500 ||
      !Number.isSafeInteger(config.breakoutBufferBps) || config.breakoutBufferBps < 0 || config.breakoutBufferBps > 500) {
    throw new RangeError("Breakout lookback or buffer is invalid");
  }
}
