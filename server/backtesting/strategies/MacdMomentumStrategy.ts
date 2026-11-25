import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { calculateMACD } from "../../market-data/core/TechnicalIndicators";
import type { BacktestStrategy, StrategySignalProvider } from "./Strategy";

export type MacdMomentumConfig = {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
};

/**
 * MACD momentum crossover.
 * LONG when MACD crosses above its signal line; SHORT when it crosses below.
 * Signals are known only after the indexed candle closes and are executed
 * no earlier than the next candle open by the shared backtest executor.
 */
export const macdMomentumStrategy: BacktestStrategy<MacdMomentumConfig> = {
  id: "macd_momentum",

  minimumHistory(config): number {
    validateConfig(config);
    // Need two valid MACD/signal observations to detect a crossing, plus
    // the following candle boundary for next-open execution.
    return config.slowPeriod + config.signalPeriod + 1;
  },

  createSignalProvider(
    candles: readonly MarketCandle[],
    config: MacdMomentumConfig,
  ): StrategySignalProvider {
    validateConfig(config);
    const closes = candles.map(candle => Number(candle.close));
    const macd = calculateMACD(closes, config.fastPeriod, config.slowPeriod, config.signalPeriod);

    return {
      signalAt(closedCandleIndex) {
        if (!Number.isInteger(closedCandleIndex) || closedCandleIndex < 1 ||
            closedCandleIndex >= candles.length) return null;
        const previousLine = macd.line[closedCandleIndex - 1];
        const previousSignal = macd.signal[closedCandleIndex - 1];
        const currentLine = macd.line[closedCandleIndex];
        const currentSignal = macd.signal[closedCandleIndex];
        if (previousLine === null || previousSignal === null ||
            currentLine === null || currentSignal === null) return null;

        if (previousLine <= previousSignal && currentLine > currentSignal) return "LONG";
        if (previousLine >= previousSignal && currentLine < currentSignal) return "SHORT";
        return null;
      },
    };
  },
};

function validateConfig(config: MacdMomentumConfig): void {
  if (!Number.isSafeInteger(config.fastPeriod) || config.fastPeriod < 2 || config.fastPeriod > 100 ||
      !Number.isSafeInteger(config.slowPeriod) || config.slowPeriod <= config.fastPeriod || config.slowPeriod > 300 ||
      !Number.isSafeInteger(config.signalPeriod) || config.signalPeriod < 2 || config.signalPeriod > 100) {
    throw new RangeError("MACD periods are invalid");
  }
}
