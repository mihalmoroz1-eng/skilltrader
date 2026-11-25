import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { calculateEMA } from "../../market-data/core/TechnicalIndicators";
import type { BacktestStrategy, StrategySignalProvider } from "./Strategy";

export type EmaCrossoverConfig = {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
};

/**
 * EMA crossover signal source. A signal at index N uses only candles through
 * N; the execution engine may fill it no earlier than candle N+1 open.
 */
export const emaCrossoverStrategy: BacktestStrategy<EmaCrossoverConfig> = {
  id: "ema_crossover",

  minimumHistory(config): number {
    return config.slowEmaPeriod + 2;
  },

  createSignalProvider(
    candles: readonly MarketCandle[],
    config: EmaCrossoverConfig,
  ): StrategySignalProvider {
    const closes = candles.map(candle => Number(candle.close));
    const fast = calculateEMA(closes, config.fastEmaPeriod);
    const slow = calculateEMA(closes, config.slowEmaPeriod);

    return {
      signalAt(closedCandleIndex) {
        if (!Number.isInteger(closedCandleIndex) || closedCandleIndex < 1 ||
            closedCandleIndex >= candles.length) return null;
        const previousIndex = closedCandleIndex - 1;
        const previousFast = fast[previousIndex];
        const previousSlow = slow[previousIndex];
        const currentFast = fast[closedCandleIndex];
        const currentSlow = slow[closedCandleIndex];
        if (previousFast === null || previousSlow === null ||
            currentFast === null || currentSlow === null) return null;

        if (previousFast <= previousSlow && currentFast > currentSlow) return "LONG";
        if (previousFast >= previousSlow && currentFast < currentSlow) return "SHORT";
        return null;
      },
    };
  },
};
