import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { BacktestInputError, runBacktest, runBacktestWithStrategy } from "../core/BacktestEngine";
import { rsiMeanReversionStrategy } from "../strategies/RsiMeanReversionStrategy";
import { emaCrossoverStrategy } from "../strategies/EmaCrossoverStrategy";

function series(closes: number[]): MarketCandle[] {
  const start = 1_700_000_000_000;
  return closes.map((close, index) => ({
    openTime: start + index * 60_000,
    closeTime: start + index * 60_000 + 59_999,
    open: String(index === 0 ? close : closes[index - 1]),
    high: String(Math.max(close, index === 0 ? close : closes[index - 1]) + 0.5),
    low: String(Math.min(close, index === 0 ? close : closes[index - 1]) - 0.5),
    close: String(close), volume: "100", quoteVolume: String(close * 100), tradeCount: 10,
  }));
}
const config = {
  symbol: "BTCUSDT", interval: "1m" as const, startingCapital: 10_000,
  riskBps: 50, stopLossBps: 200, takeProfitBps: 400,
  feeBps: 0, slippageBps: 0, fastEmaPeriod: 2, slowEmaPeriod: 3, allowShort: false,
};

describe("historical backtesting engine", () => {
  it("produces reproducible results and never marks them execution eligible", () => {
    const candles = series([10, 10, 10, 11, 13, 15, 17, 18, 17, 15, 13, 11]);
    const first = runBacktest(candles, config);
    const second = runBacktest(candles, config);
    expect(first).toEqual(second);
    expect(first.executionEligible).toBe(false);
    expect(first.strategy).toBe("ema_crossover");
    expect(first.candlesProcessed).toBe(candles.length);
  });

  it("binds run identity to the exact historical candle content", () => {
    const first = runBacktest(series([10, 10, 10, 12, 14, 16, 18, 20, 18, 16, 14, 12]), config);
    const changed = runBacktest(series([10, 10, 10, 12, 14, 16, 19, 20, 18, 16, 14, 12]), config);
    expect(first.dataDigest).not.toBe(changed.dataDigest);
    expect(first.runId).not.toBe(changed.runId);
  });

  it("executes crossover signals no earlier than the next candle open", () => {
    const candles = series([10, 10, 10, 12, 14, 16, 18, 20, 18, 16, 14, 12]);
    const result = runBacktest(candles, config);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades[0].entryTime).toBeGreaterThan(candles[config.slowEmaPeriod].openTime);
  });

  it("assumes stop-loss first when stop and target are both touched in one candle", () => {
    const candles = series([10, 10, 10, 12, 14, 16, 18, 20, 18, 16, 14, 12]);
    const entryCandle = candles[4];
    candles[4] = { ...entryCandle, high: "20", low: "1" };
    const result = runBacktest(candles, config);
    expect(result.trades[0]?.entryTime).toBe(candles[4].openTime);
    expect(result.trades[0]?.exitReason).toBe("stop_loss");
    expect(result.trades[0]?.exitTime).toBe(candles[4].closeTime);
  });

  it("rejects historical gaps rather than calculating across missing candles", () => {
    const candles = series([10, 10, 10, 12, 14, 16, 18, 20]);
    candles.splice(5, 1);
    expect(() => runBacktest(candles, config)).toThrow(BacktestInputError);
  });

  it("rejects insufficient warm-up history", () => {
    expect(() => runBacktest(series([10, 11, 12]), config)).toThrow(/Insufficient candles/);
  });

  it("applies fees and slippage as costs", () => {
    const candles = series([10, 10, 10, 12, 14, 16, 18, 20, 18, 16, 14, 12]);
    const free = runBacktest(candles, config);
    const costly = runBacktest(candles, { ...config, feeBps: 10, slippageBps: 5 });
    expect(costly.metrics.feesPaid).toBeGreaterThan(0);
    expect(costly.metrics.finalEquity).toBeLessThan(free.metrics.finalEquity);
  });
  it("runs RSI through the shared execution engine with directional exits", () => {
    const candles = series([100, 90, 80, 90, 100, 110, 100, 90, 80, 70]);
    const { fastEmaPeriod: _fast, slowEmaPeriod: _slow, ...executionConfig } = {
      ...config, stopLossBps: 2_000, takeProfitBps: 5_000, allowShort: true,
    };
    const result = runBacktestWithStrategy(
      candles,
      executionConfig,
      rsiMeanReversionStrategy,
      { rsiPeriod: 2, oversoldLevel: 30, overboughtLevel: 70 },
    );
    expect(result.strategy).toBe("rsi_mean_reversion");
    expect(result.executionEligible).toBe(false);
    expect(result.trades.map(trade => trade.side)).toEqual(["LONG", "SHORT"]);
    expect(result.trades.map(trade => trade.exitReason)).toEqual(["strategy_exit", "strategy_exit"]);
    expect(result.trades[0].entryTime).toBe(candles[4].openTime);
    expect(result.trades[0].exitTime).toBe(candles[5].openTime);
    expect(result.trades[1].entryTime).toBe(candles[7].openTime);
    expect(result.trades[1].exitTime).toBe(candles[8].openTime);
  });

  it("selects RSI from the public backtest configuration", () => {
    const candles = series([100, 90, 80, 90, 100, 110, 100, 90, 80, 70]);
    const result = runBacktest(candles, {
      ...config, strategy: "rsi_mean_reversion", rsiPeriod: 2,
      rsiOversoldLevel: 30, rsiOverboughtLevel: 70, allowShort: true,
      stopLossBps: 2_000, takeProfitBps: 5_000,
    });
    expect(result.strategy).toBe("rsi_mean_reversion");
    expect(result.trades.map(trade => trade.side)).toEqual(["LONG", "SHORT"]);
    expect(result.executionEligible).toBe(false);
  });
  it("selects MACD through the public backtest runner", () => {
    const closes = [
      ...Array.from({ length: 24 }, (_, index) => 120 - index * 2),
      ...Array.from({ length: 20 }, (_, index) => 72 + index * 3),
      ...Array.from({ length: 20 }, (_, index) => 129 - index * 3),
    ];
    const candles = series(closes);
    const result = runBacktest(candles, {
      ...config, strategy: "macd_momentum", macdFastPeriod: 3,
      macdSlowPeriod: 6, macdSignalPeriod: 3, allowShort: true,
      stopLossBps: 2_000, takeProfitBps: 5_000,
    });
    expect(result.strategy).toBe("macd_momentum");
    expect(result.executionEligible).toBe(false);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.every(trade => trade.entryTime > candles[8].openTime)).toBe(true);
  });

  it("selects Breakout through the public runner and fills only at the next candle open", () => {
    const candles = series([10, 10, 10, 10, 12, 13, 13, 13]);
    const result = runBacktest(candles, {
      ...config, strategy: "breakout", breakoutLookbackPeriod: 3,
      breakoutBufferBps: 10, stopLossBps: 2_000, takeProfitBps: 5_000,
    });
    expect(result.strategy).toBe("breakout");
    expect(result.executionEligible).toBe(false);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades[0].entryTime).toBe(candles[5].openTime);
  });

  it("binds run identity to the selected strategy and its parameters", () => {
    const candles = series([100, 90, 80, 90, 100, 110, 100, 90, 80, 70]);
    const { fastEmaPeriod: _fast, slowEmaPeriod: _slow, ...executionConfig } = {
      ...config, stopLossBps: 2_000, takeProfitBps: 5_000, allowShort: true,
    };
    const first = runBacktestWithStrategy(candles, executionConfig, rsiMeanReversionStrategy,
      { rsiPeriod: 2, oversoldLevel: 30, overboughtLevel: 70 });
    const changed = runBacktestWithStrategy(candles, executionConfig, rsiMeanReversionStrategy,
      { rsiPeriod: 3, oversoldLevel: 30, overboughtLevel: 70 });
    expect(first.runId).not.toBe(changed.runId);
  });
  it("keeps EMA wrapper behavior identical to the shared strategy executor", () => {
    const candles = series([10, 10, 10, 11, 13, 15, 17, 18, 17, 15, 13, 11]);
    const wrapped = runBacktest(candles, config);
    const { fastEmaPeriod, slowEmaPeriod, ...executionConfig } = config;
    const shared = runBacktestWithStrategy(
      candles, executionConfig, emaCrossoverStrategy, { fastEmaPeriod, slowEmaPeriod },
    );
    expect(shared.trades).toEqual(wrapped.trades);
    expect(shared.metrics).toEqual(wrapped.metrics);
    expect(shared.strategy).toBe(wrapped.strategy);
  });
});
