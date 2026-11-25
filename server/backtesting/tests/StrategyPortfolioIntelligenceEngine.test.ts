import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import {
  runStrategyPortfolioIntelligence,
  StrategyPortfolioInputError,
} from "../core/StrategyPortfolioIntelligenceEngine";

function series(length: number): MarketCandle[] {
  const start = 1_700_000_000_000;
  return Array.from({ length }, (_, index) => {
    const close = 100 + index * 0.04 + Math.sin(index / 2.7) * 3 + Math.sin(index / 7) * 1.5;
    const previous = index === 0 ? close : 100 + (index - 1) * 0.04 + Math.sin((index - 1) / 2.7) * 3 + Math.sin((index - 1) / 7) * 1.5;
    return {
      openTime: start + index * 60_000,
      closeTime: start + index * 60_000 + 59_999,
      open: String(previous),
      high: String(Math.max(previous, close) + 0.5),
      low: String(Math.min(previous, close) - 0.5),
      close: String(close),
      volume: "100",
      quoteVolume: String(close * 100),
      tradeCount: 10,
    };
  });
}

const config = {
  symbol: "BTCUSDT",
  interval: "1m" as const,
  startingCapital: 10_000,
  riskBps: 50,
  stopLossBps: 200,
  takeProfitBps: 400,
  feeBps: 5,
  slippageBps: 5,
  fastEmaPeriod: 10,
  slowEmaPeriod: 20,
  allowShort: true,
  rsiPeriod: 8,
  rsiOversoldLevel: 30,
  rsiOverboughtLevel: 70,
  macdFastPeriod: 8,
  macdSlowPeriod: 17,
  macdSignalPeriod: 5,
  breakoutLookbackPeriod: 12,
  breakoutBufferBps: 10,
  trainingCandles: 55,
  validationCandles: 20,
  stepCandles: 20,
  windowCount: 2,
  regimeLookback: 10,
  trendThresholdBps: 100,
  rangeThresholdBps: 50,
  highVolatilityThresholdBps: 200,
};

describe("strategy portfolio intelligence", () => {
  it("compares all four strategies on identical independent OOS windows", () => {
    const result = runStrategyPortfolioIntelligence(series(115), config);
    expect(result.strategies.map(item => item.strategy)).toEqual([
      "ema_crossover", "rsi_mean_reversion", "macd_momentum", "breakout",
    ]);
    expect(new Set(result.strategies.map(item => item.dataDigest)).size).toBe(1);
    expect(new Set(result.strategies.map(item => item.validation.windows.map(window =>
      [window.validationStartTime, window.validationEndTime].join(":"),
    ).join("|"))).size).toBe(1);
    expect(new Set(result.strategies.map(item => item.runId)).size).toBe(4);
    expect(result.strategies.every(item => item.validation.windows.length === 2)).toBe(true);
    expect(result.strategies.every(item => item.validation.executionEligible === false)).toBe(true);
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
  });

  it("requires training history for the largest strategy warm-up", () => {
    expect(() => runStrategyPortfolioIntelligence(series(100), {
      ...config, trainingCandles: 51,
    })).toThrow(StrategyPortfolioInputError);
  });

  it("is deterministic and never combines strategy returns into a synthetic portfolio", () => {
    const candles = series(115);
    const first = runStrategyPortfolioIntelligence(candles, config);
    const second = runStrategyPortfolioIntelligence(candles, config);
    expect(first).toEqual(second);
    expect(first.methodology.some(item => item.includes("not added, compounded together"))).toBe(true);
  });
});
