import type { MarketCandle } from "../../market-data/core/MarketDataTypes";

export type StrategySignal = "LONG" | "SHORT" | "EXIT_LONG" | "EXIT_SHORT" | null;

export interface StrategySignalProvider {
  /** Returns a signal known only after the indexed candle has closed. */
  signalAt(closedCandleIndex: number): StrategySignal;
}

export interface BacktestStrategy<TConfig> {
  readonly id: string;
  minimumHistory(config: TConfig): number;
  createSignalProvider(
    candles: readonly MarketCandle[],
    config: TConfig,
  ): StrategySignalProvider;
}
