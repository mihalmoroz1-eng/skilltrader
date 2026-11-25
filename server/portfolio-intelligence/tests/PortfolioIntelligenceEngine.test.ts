import { describe, expect, it } from "vitest";
import type { HistoricalCandleRecord } from "../../historical-data/core/HistoricalDataTypes";
import type { PaperPosition } from "../../paper-execution/core/PaperExecutionEngine";
import { runPortfolioIntelligence, PortfolioIntelligenceInputError } from "../core/PortfolioIntelligenceEngine";

const now = Date.UTC(2026, 10, 25, 12);
const start = Date.UTC(2026, 10, 20);
const request = { symbols: ["BTCUSDT", "ETHUSDT"], interval: "1h" as const, startTime: start, endTime: start + 40 * 3_600_000 };

function candles(symbol: string, values: number[], missing: number[] = []): HistoricalCandleRecord[] {
  return values.flatMap((close, index) => missing.includes(index) ? [] : [{
    symbol, interval: "1h" as const, openTime: start + index * 3_600_000,
    closeTime: start + index * 3_600_000 + 3_599_999,
    open: String(close), high: String(close), low: String(close), close: String(close),
    volume: "100", quoteVolume: String(close * 100), tradeCount: 10, source: "binance-spot", fetchedAt: now - 1_000,
  }]);
}
function position(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 1, userOpenId: "user-1", signalId: "a".repeat(24), marketRunId: "run",
    symbol: "BTCUSDT", interval: "1h", side: "LONG", quantity: "1", notional: "100",
    entryPrice: "100", stopPrice: "90", targetPrice: "120", contractMultiplier: "1",
    tickSize: "0.1", entryFee: "0.1", status: "open", openedAt: now - 60_000, feesPaid: "0.1", ...overrides,
  };
}
function run(options: {
  btc?: HistoricalCandleRecord[]; eth?: HistoricalCandleRecord[]; positions?: PaperPosition[];
  markPrices?: Record<string, { markPrice: string; fetchedAt: number; source: string }> | null;
  account?: { equity: string; maxGrossExposureBps: number } | null; markToMarketAvailable?: boolean;
} = {}) {
  return runPortfolioIntelligence({
    request,
    series: [
      { symbol: "BTCUSDT", interval: "1h", candles: options.btc ?? candles("BTCUSDT", Array.from({ length: 40 }, (_, i) => 100 + i)) },
      { symbol: "ETHUSDT", interval: "1h", candles: options.eth ?? candles("ETHUSDT", Array.from({ length: 40 }, (_, i) => 200 + i * 2)) },
    ],
    portfolio: {
      account: options.account === undefined ? { equity: "1000", maxGrossExposureBps: 5000 } : options.account,
      positions: options.positions ?? [],
      markPrices: options.markPrices === undefined ? { BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" } } : options.markPrices,
      markToMarketAvailable: options.markToMarketAvailable ?? true,
    },
    now,
  });
}
describe("Portfolio Intelligence & Correlation Engine", () => {
  it("calculates Pearson correlation from aligned close-to-close returns", () => {
    const result = run();
    expect(result.correlations[0].status).toBe("ready");
    expect(result.correlations[0].correlation).toBe(1);
    expect(result.correlations[0].observations).toBe(39);
  });
  it("does not fabricate returns across a missing interval", () => {
    const result = run({ btc: candles("BTCUSDT", Array.from({ length: 40 }, (_, i) => 100 + i), [10]) });
    expect(result.series[0].gaps).toBe(1);
    expect(result.correlations[0].observations).toBe(37);
  });
  it("withholds correlation with fewer than 30 aligned returns", () => {
    const result = run({
      btc: candles("BTCUSDT", Array.from({ length: 20 }, (_, i) => 100 + i)),
      eth: candles("ETHUSDT", Array.from({ length: 20 }, (_, i) => 200 + i * 2)),
    });
    expect(result.correlations[0].status).toBe("insufficient_history");
    expect(result.correlations[0].correlation).toBeNull();
    expect(result.correlations[0].observations).toBe(19);
  });
  it("uses only exact common timestamps", () => {
    const result = run({ eth: candles("ETHUSDT", Array.from({ length: 40 }, (_, i) => 200 + i * 2), Array.from({ length: 40 }, (_, i) => i).filter(i => i % 2 === 0)) });
    expect(result.correlations[0].observations).toBe(0);
    expect(result.correlations[0].correlation).toBeNull();
  });
  it("excludes unclosed bars and rejects duplicate history", () => {
    const bars = candles("BTCUSDT", Array.from({ length: 40 }, (_, i) => 100 + i));
    bars[bars.length - 1] = { ...bars.at(-1)!, closeTime: now };
    expect(run({ btc: bars }).series[0].excludedUnclosedCandles).toBe(1);
    const duplicate = [...candles("BTCUSDT", [100, 101]), candles("BTCUSDT", [102])[0]];
    expect(() => run({ btc: duplicate })).toThrow(PortfolioIntelligenceInputError);
  });
  it("aggregates marked exposure, concentration and downside stress", () => {
    const result = run({
      positions: [
        position({ id: 1, symbol: "BTCUSDT", quantity: "1", side: "LONG" }),
        position({ id: 2, symbol: "ETHUSDT", quantity: "0.5", side: "SHORT" }),
      ],
      markPrices: {
        BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
        ETHUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
      },
    });
    expect(result.portfolio.grossExposure).toBe("150");
    expect(result.portfolio.netDirectionalExposure).toBe("50");
    expect(result.portfolio.grossExposureUtilizationBps).toBe(1500);
    expect(result.portfolio.withinConfiguredGrossExposure).toBe(true);
    expect(result.portfolio.concentration.largestSymbol).toBe("BTCUSDT");
    expect(result.portfolio.concentration.largestWeightPct).toBeCloseTo(66.6667, 3);
    expect(result.portfolio.stressScenarios?.[0].estimatedPnl).toBe("-10");
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
  });
  it("withholds stress when a mark is stale", () => {
    const result = run({
      positions: [position()],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 31_000, source: "binance" } },
    });
    expect(result.portfolio.markToMarketAvailable).toBe(false);
    expect(result.portfolio.stressScenarios).toBeNull();
  });
  it("calculates server-side risk intelligence only for held symbols and weights pairs by exposure", () => {
    const result = run({
      positions: [
        position({ id: 1, symbol: "BTCUSDT", quantity: "1" }),
        position({ id: 2, symbol: "ETHUSDT", quantity: "0.5" }),
      ],
      markPrices: {
        BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
        ETHUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
      },
    });
    expect(result.riskIntelligence.assessment).toBe("high");
    expect(result.riskIntelligence.eligiblePairs).toBe(1);
    expect(result.riskIntelligence.totalHeldPairs).toBe(1);
    expect(result.riskIntelligence.coveragePct).toBe(100);
    expect(result.riskIntelligence.weightedAbsoluteCorrelationPct).toBe(100);
    expect(result.riskIntelligence.correlatedPairs[0]).toMatchObject({
      symbolA: "BTCUSDT", symbolB: "ETHUSDT", correlation: 1, level: "very_high", observations: 39,
    });
  });
  it("uses absolute correlation for risk weighting while preserving a negative coefficient", () => {
    const btc = [100];
    const eth = [200];
    for (let i = 0; i < 39; i += 1) {
      btc.push(btc[i] * (i % 2 === 0 ? 1.01 : 1.02));
      eth.push(eth[i] * (i % 2 === 0 ? 0.99 : 0.98));
    }
    const result = run({
      btc: candles("BTCUSDT", btc), eth: candles("ETHUSDT", eth),
      positions: [position({ id: 1, symbol: "BTCUSDT" }), position({ id: 2, symbol: "ETHUSDT" })],
      markPrices: {
        BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
        ETHUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
      },
    });
    expect(result.riskIntelligence.weightedAbsoluteCorrelationPct).toBe(100);
    expect(result.riskIntelligence.correlatedPairs[0].correlation).toBe(-1);
  });
  it("withholds the overall risk assessment when held-pair correlation data is unavailable", () => {
    const result = run({
      btc: candles("BTCUSDT", Array.from({ length: 20 }, (_, i) => 100 + i)),
      eth: candles("ETHUSDT", Array.from({ length: 20 }, (_, i) => 200 + i * 2)),
      positions: [position({ id: 1, symbol: "BTCUSDT" }), position({ id: 2, symbol: "ETHUSDT" })],
      markPrices: {
        BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
        ETHUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
      },
    });
    expect(result.riskIntelligence.assessment).toBe("insufficient_data");
    expect(result.riskIntelligence.eligiblePairs).toBe(0);
    expect(result.riskIntelligence.totalHeldPairs).toBe(1);
    expect(result.riskIntelligence.weightedAbsoluteCorrelationPct).toBeNull();
  });
  it("does not calculate held-pair metrics for a single position or stale marks", () => {
    const single = run({ positions: [position()] });
    expect(single.riskIntelligence.assessment).toBe("insufficient_data");
    expect(single.riskIntelligence.totalHeldPairs).toBe(0);
    expect(single.riskIntelligence.coveragePct).toBeNull();
    const stale = run({
      positions: [position({ id: 1, symbol: "BTCUSDT" }), position({ id: 2, symbol: "ETHUSDT" })],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 31_000, source: "binance" } },
    });
    expect(stale.riskIntelligence.assessment).toBe("insufficient_data");
    expect(stale.riskIntelligence.totalHeldPairs).toBe(0);
    expect(stale.riskIntelligence.correlatedPairs).toEqual([]);
  });
  it("estimates annualized portfolio volatility and 1-day/5-day 95% VaR from aligned historical returns", () => {
    const result = run({
      btc: candles("BTCUSDT", [100, 101, 99, 103, 100, 104, 102, 106, 103, 108, 105, 110, 107, 112, 109, 115, 111, 116, 113, 118, 114, 120, 116, 122, 117, 124, 119, 126, 121, 128, 123, 130, 125, 133, 127, 135, 129, 138, 132, 140]),
      eth: candles("ETHUSDT", [200, 202, 198, 205, 201, 207, 203, 210, 206, 213, 208, 216, 211, 219, 214, 223, 217, 225, 220, 230, 224, 233, 226, 236, 229, 240, 232, 243, 235, 247, 238, 250, 242, 255, 245, 258, 249, 263, 253, 267]),
      positions: [position({ id: 1, symbol: "BTCUSDT", quantity: "1" }), position({ id: 2, symbol: "ETHUSDT", quantity: "0.5" })],
      markPrices: {
        BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
        ETHUSDT: { markPrice: "200", fetchedAt: now - 500, source: "binance" },
      },
    });
    expect(result.riskForecast.status).toBe("ready");
    expect(result.riskForecast.method).toBe("historical_covariance_normal_approximation");
    expect(result.riskForecast.annualizedPortfolioVolatilityPct).toBeGreaterThan(0);
    expect(result.riskForecast.oneDay95VaR).not.toBeNull();
    expect(result.riskForecast.fiveDay95VaR).not.toBeNull();
    expect(result.riskForecast.fiveDay95VaRPctOfEquity).toBeGreaterThan(result.riskForecast.oneDay95VaRPctOfEquity!);
    expect(result.riskForecast.observations).toBe(39);
    expect(result.riskForecast.symbols).toHaveLength(2);
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
  });
  it("withholds volatility and VaR when any held symbol lacks sufficient history", () => {
    const result = run({
      btc: candles("BTCUSDT", Array.from({ length: 20 }, (_, i) => 100 + i)),
      eth: candles("ETHUSDT", Array.from({ length: 40 }, (_, i) => 200 + i * 2)),
      positions: [position({ id: 1, symbol: "BTCUSDT" }), position({ id: 2, symbol: "ETHUSDT" })],
      markPrices: {
        BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
        ETHUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" },
      },
    });
    expect(result.riskForecast.status).toBe("insufficient_data");
    expect(result.riskForecast.annualizedPortfolioVolatilityPct).toBeNull();
    expect(result.riskForecast.oneDay95VaR).toBeNull();
    expect(result.riskForecast.observations).toBe(19);
  });
  it("does not produce a volatility forecast from stale marks or an empty portfolio", () => {
    const stale = run({
      positions: [position()],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 31_000, source: "binance" } },
    });
    expect(stale.riskForecast.status).toBe("stale_marks");
    expect(stale.riskForecast.oneDay95VaR).toBeNull();
    const empty = run();
    expect(empty.riskForecast.status).toBe("no_exposure");
    expect(empty.riskForecast.fiveDay95VaR).toBeNull();
  });
  it("calculates a recovered maximum drawdown and current recovery state", () => {
    const returns = [
      ...Array(10).fill(0.01), ...Array(5).fill(-0.02),
      ...Array(5).fill(0.025), ...Array(19).fill(0.002),
    ];
    let price = 100;
    const values = [price];
    for (const value of returns) { price *= 1 + value; values.push(price); }
    const result = run({
      btc: candles("BTCUSDT", values),
      positions: [position()],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" } },
    });
    expect(result.drawdownIntelligence.status).toBe("ready");
    expect(result.drawdownIntelligence.maxDrawdownPct).toBeGreaterThan(5);
    expect(result.drawdownIntelligence.maxDrawdownRecovered).toBe(true);
    expect(result.drawdownIntelligence.currentDrawdownPct).toBe(0);
    expect(result.drawdownIntelligence.currentDrawdownDurationObservations).toBeNull();
    expect(result.drawdownIntelligence.observations).toBe(39);
    expect(result.drawdownIntelligence.episodeCount).toBe(1);
    expect(result.drawdownIntelligence.recoveredEpisodeCount).toBe(1);
    expect(result.drawdownIntelligence.unrecoveredEpisodeCount).toBe(0);
    expect(result.drawdownIntelligence.averageRecoveryObservations).toBeGreaterThan(0);
    expect(result.drawdownIntelligence.curve.length).toBeGreaterThan(1);
    expect(result.drawdownIntelligence.curve.length).toBeLessThanOrEqual(120);
    expect(result.drawdownIntelligence.recentEpisodes[0].recoveryTime).not.toBeNull();
  });
  it("reports an ongoing drawdown without inventing a recovery", () => {
    const returns = [...Array(10).fill(0.01), ...Array(29).fill(-0.005)];
    let price = 100;
    const values = [price];
    for (const value of returns) { price *= 1 + value; values.push(price); }
    const result = run({
      btc: candles("BTCUSDT", values),
      positions: [position()],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" } },
    });
    expect(result.drawdownIntelligence.status).toBe("ready");
    expect(result.drawdownIntelligence.currentDrawdownPct).toBeGreaterThan(0);
    expect(result.drawdownIntelligence.currentDrawdownDurationObservations).toBeGreaterThan(0);
    expect(result.drawdownIntelligence.maxDrawdownRecovered).toBe(false);
    expect(result.drawdownIntelligence.episodeCount).toBe(1);
    expect(result.drawdownIntelligence.unrecoveredEpisodeCount).toBe(1);
    expect(result.drawdownIntelligence.averageRecoveryObservations).toBeNull();
    expect(result.drawdownIntelligence.recentEpisodes[0].recoveryTime).toBeNull();
  });
  it("returns zero drawdown for a monotonically rising path and respects SHORT direction", () => {
    const rising = run({
      btc: candles("BTCUSDT", Array.from({ length: 40 }, (_, i) => 100 + i)),
      positions: [position({ side: "LONG" })],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" } },
    });
    expect(rising.drawdownIntelligence.status).toBe("ready");
    expect(rising.drawdownIntelligence.maxDrawdownPct).toBe(0);
    expect(rising.drawdownIntelligence.maxDrawdownRecovered).toBe(true);
    const fallingPrices = run({
      btc: candles("BTCUSDT", Array.from({ length: 40 }, (_, i) => 140 - i)),
      positions: [position({ side: "SHORT" })],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" } },
    });
    expect(fallingPrices.drawdownIntelligence.maxDrawdownPct).toBe(0);
  });
  it("withholds drawdown when common consecutive history is insufficient or marks are stale", () => {
    const gap = run({
      btc: candles("BTCUSDT", Array.from({ length: 40 }, (_, i) => 100 + i), [10]),
      positions: [position()],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 500, source: "binance" } },
    });
    expect(gap.drawdownIntelligence.status).toBe("insufficient_data");
    const stale = run({
      positions: [position()],
      markPrices: { BTCUSDT: { markPrice: "100", fetchedAt: now - 31_000, source: "binance" } },
    });
    expect(stale.drawdownIntelligence.status).toBe("stale_marks");
    expect(stale.drawdownIntelligence.maxDrawdownPct).toBeNull();
    const empty = run();
    expect(empty.drawdownIntelligence.status).toBe("no_exposure");
  });
  it("is deterministic and rejects a range above the candle cap", () => {
    expect(run()).toEqual(run());
    expect(() => runPortfolioIntelligence({
      request: { ...request, endTime: start + 5_001 * 3_600_000 },
      series: [], portfolio: { account: null, positions: [], markPrices: null, markToMarketAvailable: false }, now,
    })).toThrow(/5,000 candles/);
  });
});
