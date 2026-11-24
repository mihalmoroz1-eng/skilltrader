import { describe, expect, it } from "vitest";
import { processMarketData, MarketDataProcessingError } from "../core/MarketDataProcessor";
import type { MarketCandle, MarketDataSnapshot, MarketInterval } from "../core/MarketDataTypes";

const INTERVAL_MS = 15 * 60 * 1000;
const START = Date.UTC(2026, 0, 1);

function makeCandles(count: number, interval: MarketInterval = "15m"): MarketCandle[] {
  const intervalMs = interval === "15m" ? INTERVAL_MS : 60_000;
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index / 10;
    const close = open + 0.05;
    const openTime = START + index * intervalMs;
    return {
      openTime,
      closeTime: openTime + intervalMs - 1,
      open: String(open),
      high: String(close + 0.5),
      low: String(open - 0.5),
      close: String(close),
      volume: "10",
      quoteVolume: String(close * 10),
      tradeCount: 12,
    };
  });
}

function snapshot(candles: MarketCandle[], interval: MarketInterval = "15m"): MarketDataSnapshot {
  return {
    symbol: "BTCUSDT",
    interval,
    source: "binance-spot",
    fetchedAt: START + 100_000_000,
    freshness: "live",
    candles,
  };
}

describe("deterministic market data processor", () => {
  it("computes indicators from closed candles and preserves exact source strings", () => {
    const candles = makeCandles(70);
    const last = candles[candles.length - 1];
    const result = processMarketData(snapshot(candles), last.closeTime + 1);

    expect(result.quality.status).toBe("ready");
    expect(result.quality.closedCandleCount).toBe(70);
    expect(result.indicators).toHaveLength(70);
    expect(result.indicators[18].ema20).toBeNull();
    expect(result.indicators[19].ema20).not.toBeNull();
    expect(result.indicators[48].ema50).toBeNull();
    expect(result.indicators[49].ema50).not.toBeNull();
    expect(result.indicators[69].rsi14).not.toBeNull();
    expect(result.indicators[69].macdHistogram).not.toBeNull();
    expect(result.indicators[69].atr14).not.toBeNull();
    expect(result.indicators[69].vwap).not.toBeNull();
    expect(result.candles[0].open).toBe("100");
  });

  it("excludes the still-forming candle from indicator calculations", () => {
    const candles = makeCandles(60);
    const last = candles[candles.length - 1];
    const result = processMarketData(snapshot(candles), last.closeTime);

    expect(result.quality.incompleteCandleCount).toBe(1);
    expect(result.quality.closedCandleCount).toBe(59);
    expect(result.indicators[result.indicators.length - 1].openTime).toBe(candles[58].openTime);
    expect(result.quality.warnings).toContain("Unclosed candles were excluded from indicator calculations.");
  });

  it("detects missing intervals and resets indicator warm-up after a gap", () => {
    const candles = makeCandles(70);
    candles.splice(55, 1);
    const result = processMarketData(snapshot(candles), candles[candles.length - 1].closeTime + 1);

    expect(result.quality.status).toBe("degraded");
    expect(result.quality.gapCount).toBe(1);
    expect(result.quality.estimatedMissingIntervals).toBe(1);
    expect(result.quality.continuousSegments).toBe(2);
    expect(result.indicators.at(-1)?.ema20).toBeNull();
    expect(result.quality.warnings).toContain("Missing intervals split the series; indicators were reset after each gap.");
  });

  it("marks short series as insufficient without fabricating warm-up values", () => {
    const candles = makeCandles(30);
    const result = processMarketData(snapshot(candles), candles[candles.length - 1].closeTime + 1);

    expect(result.quality.status).toBe("insufficient");
    expect(result.indicators.every((point) => point.ema50 === null)).toBe(true);
    expect(result.indicators.every((point) => point.macdSignal === null)).toBe(true);
  });

  it("handles calendar month intervals without false-positive gaps", () => {
    const candles: MarketCandle[] = [
      {
        openTime: Date.UTC(2026, 0, 1),
        closeTime: Date.UTC(2026, 0, 31, 23, 59, 59, 999),
        open: "100", high: "110", low: "90", close: "105",
        volume: "100", quoteVolume: "10500", tradeCount: 100,
      },
      {
        openTime: Date.UTC(2026, 1, 1),
        closeTime: Date.UTC(2026, 1, 28, 23, 59, 59, 999),
        open: "105", high: "115", low: "95", close: "110",
        volume: "120", quoteVolume: "13200", tradeCount: 120,
      },
    ];
    const result = processMarketData(snapshot(candles, "1M"), Date.UTC(2026, 2, 1));
    expect(result.quality.gapCount).toBe(0);
    expect(result.quality.continuousSegments).toBe(1);
  });

  it("rejects invalid snapshots, timestamps and structurally invalid candles", () => {
    const candles = makeCandles(5);
    expect(() => processMarketData(snapshot(candles), Number.NaN)).toThrow(MarketDataProcessingError);
    expect(() => processMarketData(snapshot([{ ...candles[0], high: "1" }]), candles[0].closeTime + 1)).toThrow();
    expect(() => processMarketData(snapshot(makeCandles(1_001)), START + 100_000_000)).toThrow(/processing limit/);
  });
});
