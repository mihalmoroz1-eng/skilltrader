import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { BacktestInputError, runBacktest } from "../core/BacktestEngine";

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
    candles[5] = { ...candles[5], openTime: candles[5].openTime + 60_000, closeTime: candles[5].closeTime + 60_000 };
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
});
