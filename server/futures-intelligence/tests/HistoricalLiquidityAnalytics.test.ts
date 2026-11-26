import { describe, expect, it } from "vitest";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import type { HistoricalOrderBookSnapshot } from "../core/HistoricalOrderBookTypes";
import {
  analyzeHistoricalLiquidityCoverage,
  simulateHistoricalLiquidityFill,
} from "../core/HistoricalLiquidityAnalytics";

const BASE = 1_800_000_000_000;
const digest = "a".repeat(64);
const snapshot = (observedAt: number, bids = [
  { price: "100", quantity: "5" }, { price: "99", quantity: "8" },
], asks = [
  { price: "101", quantity: "4" }, { price: "102", quantity: "7" },
]): HistoricalOrderBookSnapshot => ({
  symbol: "BTCUSDT", source: "binance-usdm-futures",
  observedAt, fetchedAt: observedAt - 10, lastUpdateId: observedAt,
  bestBid: bids[0].price, bestAsk: asks[0].price, bids, asks,
  bidLevels: bids.length, askLevels: asks.length, contentDigest: digest,
});
const candles: MarketCandle[] = [0, 60_000, 120_000].map(offset => ({
  openTime: BASE + offset, closeTime: BASE + offset + 59_999,
  open: "100", high: "102", low: "99", close: "101",
  volume: "1", quoteVolume: "100", tradeCount: 1,
}));

describe("Historical Liquidity Analytics", () => {
  it("measures exact causal snapshot coverage at candle-open execution times", () => {
    const result = analyzeHistoricalLiquidityCoverage("BTCUSDT", candles, [
      snapshot(BASE), snapshot(BASE + 120_000),
    ], 30_000);
    expect(result.matchedCount).toBe(2);
    expect(result.staleCount).toBe(1);
    expect(result.missingCount).toBe(0);
    expect(result.coveragePct).toBeCloseTo(66.6667, 3);
    expect(result.status).toBe("partial");
    expect(result.lookAheadPrevented).toBe(true);
  });

  it("never uses a snapshot observed after the decision timestamp", () => {
    const result = analyzeHistoricalLiquidityCoverage("BTCUSDT", [candles[0]], [
      snapshot(BASE + 1),
    ]);
    expect(result.missingCount).toBe(1);
    expect(result.matchedCount).toBe(0);
  });

  it("walks asks for BUY and returns exact visible-depth VWAP", () => {
    const result = simulateHistoricalLiquidityFill({
      snapshot: snapshot(BASE), decisionTime: BASE + 100, side: "BUY", requestedQuantity: "6",
    });
    expect(result.status).toBe("filled");
    expect(result.filledQuantity).toBe("6");
    expect(result.vwap).toBe("101.333333333333333333");
    expect(result.spreadBps).toBe("99.502487562189054726");
    expect(Number(result.marketImpactBps)).toBeGreaterThan(0);
    expect(Number(result.marketImpactBps)).toBeLessThan(Number(result.spreadBps));
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
  });

  it("walks bids for SELL and refuses to call partial visible depth a fill", () => {
    const result = simulateHistoricalLiquidityFill({
      snapshot: snapshot(BASE), decisionTime: BASE + 100, side: "SELL", requestedQuantity: "20",
    });
    expect(result.status).toBe("insufficient_depth");
    expect(result.filledQuantity).toBeNull();
    expect(result.vwap).toBeNull();
    expect(result.availableQuantity).toBe("13");
  });

  it("withholds fills from stale snapshots", () => {
    const result = simulateHistoricalLiquidityFill({
      snapshot: snapshot(BASE), decisionTime: BASE + 30_001, side: "BUY",
      requestedQuantity: "1", maxAgeMs: 30_000,
    });
    expect(result.status).toBe("stale_snapshot");
    expect(result.vwap).toBeNull();
  });

  it("rejects malformed ordering and non-finite precision inputs", () => {
    expect(() => simulateHistoricalLiquidityFill({
      snapshot: snapshot(BASE, [
        { price: "99", quantity: "1" }, { price: "100", quantity: "1" },
      ]), decisionTime: BASE, side: "SELL", requestedQuantity: "1",
    })).toThrow(/sorted/);
    expect(() => simulateHistoricalLiquidityFill({
      snapshot: snapshot(BASE), decisionTime: BASE, side: "BUY", requestedQuantity: "1.0000000000000000001",
    })).toThrow(/decimal/);
  });
});
