import { describe, expect, it } from "vitest";
import {
  CANDLE_INTERVALS_MS,
  DEMO_CANDLE_INTERVAL_MS,
  formatCandleCountdown,
  getCandleTimeRemaining,
} from "../client/src/lib/candleTimer";

describe("educational candle timer", () => {
  it("counts down to the next 15-minute boundary", () => {
    expect(getCandleTimeRemaining(0)).toBe(DEMO_CANDLE_INTERVAL_MS);
    expect(getCandleTimeRemaining(14 * 60 * 1000)).toBe(60 * 1000);
    expect(getCandleTimeRemaining(15 * 60 * 1000 - 500)).toBe(1000);
    expect(getCandleTimeRemaining(15 * 60 * 1000)).toBe(DEMO_CANDLE_INTERVAL_MS);
  });

  it("uses the selected hourly or four-hour interval", () => {
    expect(CANDLE_INTERVALS_MS["1ч"]).toBe(60 * 60 * 1000);
    expect(CANDLE_INTERVALS_MS["4ч"]).toBe(4 * 60 * 60 * 1000);
    expect(getCandleTimeRemaining(59 * 60 * 1000, CANDLE_INTERVALS_MS["1ч"])).toBe(60 * 1000);
    expect(getCandleTimeRemaining(3 * 60 * 60 * 1000, CANDLE_INTERVALS_MS["4ч"])).toBe(60 * 60 * 1000);
    expect(getCandleTimeRemaining(4 * 60 * 60 * 1000, CANDLE_INTERVALS_MS["4ч"])).toBe(4 * 60 * 60 * 1000);
  });

  it("formats minutes and seconds with ceiling to the next visible second", () => {
    expect(formatCandleCountdown(DEMO_CANDLE_INTERVAL_MS)).toBe("15:00");
    expect(formatCandleCountdown(89_100)).toBe("01:30");
    expect(formatCandleCountdown(3 * 60 * 60 * 1000)).toBe("03:00:00");
    expect(formatCandleCountdown(1)).toBe("00:01");
    expect(formatCandleCountdown(0)).toBe("00:00");
  });

  it("returns a safe zero value for invalid clock inputs", () => {
    expect(getCandleTimeRemaining(Number.NaN)).toBe(0);
    expect(getCandleTimeRemaining(0, 0)).toBe(0);
    expect(formatCandleCountdown(Number.NaN)).toBe("00:00");
  });
});
