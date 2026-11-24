import { describe, expect, it } from "vitest";
import {
  calculateATR,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateVWAP,
} from "../core/TechnicalIndicators";
import type { NumericCandle } from "../core/TechnicalIndicators";

const flatCandles = (count: number, close = 10): NumericCandle[] =>
  Array.from({ length: count }, () => ({
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }));

describe("deterministic technical indicators", () => {
  it("seeds EMA with the first SMA and applies the standard smoothing factor", () => {
    expect(calculateEMA([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("uses Wilder smoothing for RSI and handles flat and one-way series", () => {
    const rsi = calculateRSI([1, 2, 3, 2, 1, 2], 2);
    expect(rsi.slice(0, 2)).toEqual([null, null]);
    expect(rsi[2]).toBe(100);
    expect(rsi[3]).toBe(50);
    expect(rsi[4]).toBe(25);
    expect(rsi[5]).toBe(62.5);
    expect(calculateRSI([5, 5, 5, 5], 2).slice(2)).toEqual([50, 50]);
    expect(calculateRSI([1, 2, 3, 4], 2).slice(2)).toEqual([100, 100]);
  });

  it("produces MACD line, signal and histogram only after their warm-up periods", () => {
    const macd = calculateMACD(Array.from({ length: 40 }, (_, index) => 100 + index));
    expect(macd.line[24]).toBeNull();
    expect(macd.line[25]).not.toBeNull();
    expect(macd.signal[32]).toBeNull();
    expect(macd.signal[33]).not.toBeNull();
    expect(macd.histogram[33]).toBeCloseTo(macd.line[33]! - macd.signal[33]!, 12);
    expect(calculateMACD(Array(40).fill(100)).histogram[39]).toBeCloseTo(0, 12);
  });

  it("calculates Wilder ATR using true range and prior close", () => {
    const candles: NumericCandle[] = [
      { high: 11, low: 9, close: 10, volume: 1 },
      { high: 12, low: 10, close: 11, volume: 1 },
      { high: 13, low: 11, close: 12, volume: 1 },
      { high: 14, low: 12, close: 13, volume: 1 },
    ];
    const atr = calculateATR(candles, 2);
    expect(atr.slice(0, 2)).toEqual([null, null]);
    expect(atr[2]).toBe(2);
    expect(atr[3]).toBe(2);
  });

  it("calculates cumulative VWAP and returns null when no volume has traded", () => {
    const candles: NumericCandle[] = [
      { high: 12, low: 8, close: 10, volume: 2 },
      { high: 15, low: 9, close: 12, volume: 1 },
    ];
    const vwap = calculateVWAP(candles);
    expect(vwap[0]).toBe(10);
    expect(vwap[1]).toBeCloseTo(32 / 3, 12);
    expect(calculateVWAP([
      { high: 12, low: 8, close: 10, volume: 0 },
    ])).toEqual([null]);
  });

  it("rejects invalid periods and non-finite input values", () => {
    expect(() => calculateEMA([1, 2], 0)).toThrow(RangeError);
    expect(() => calculateRSI([1, Number.NaN], 1)).toThrow(RangeError);
    expect(() => calculateATR(flatCandles(3), 0)).toThrow(RangeError);
    expect(() => calculateMACD([1, 2, 3], 26, 12, 9)).toThrow(/fast period/);
  });

  it("keeps weighted VWAP finite for large but valid volume values", () => {
    const vwap = calculateVWAP([
      { high: 12, low: 8, close: 10, volume: 1e308 },
      { high: 15, low: 9, close: 12, volume: 1e308 },
    ]);
    expect(vwap[0]).toBe(10);
    expect(vwap[1]).toBeCloseTo(11, 12);
  });

  it("rejects invalid numeric candles", () => {
    expect(() => calculateVWAP([{ high: 9, low: 10, close: 10, volume: 1 }])).toThrow(RangeError);
  });
});
