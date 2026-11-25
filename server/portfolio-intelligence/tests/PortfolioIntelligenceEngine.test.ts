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
  it("is deterministic and rejects a range above the candle cap", () => {
    expect(run()).toEqual(run());
    expect(() => runPortfolioIntelligence({
      request: { ...request, endTime: start + 5_001 * 3_600_000 },
      series: [], portfolio: { account: null, positions: [], markPrices: null, markToMarketAvailable: false }, now,
    })).toThrow(/5,000 candles/);
  });
});
