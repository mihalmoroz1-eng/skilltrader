import { describe, expect, it } from "vitest";
import { MarketDataRateLimiter } from "../services/MarketDataRateLimiter";

describe("market data rate limiter", () => {
  it("limits requests per user inside a rolling minute", () => {
    const limiter = new MarketDataRateLimiter(2, 5);

    expect(limiter.consume("user-a", 1_000)).toEqual({ allowed: true });
    expect(limiter.consume("user-a", 1_001)).toEqual({ allowed: true });
    expect(limiter.consume("user-a", 1_002)).toMatchObject({
      allowed: false,
      scope: "minute",
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("user-a", 61_001)).toEqual({ allowed: true });
  });

  it("bounds the number of tracked users and cleans expired entries", () => {
    const limiter = new MarketDataRateLimiter(10, 1);

    expect(limiter.consume("user-a", 1_000)).toEqual({ allowed: true });
    expect(limiter.consume("user-b", 1_001)).toMatchObject({ allowed: false, scope: "capacity" });
    expect(limiter.trackedUsers).toBe(1);
    expect(limiter.consume("user-b", 61_001)).toEqual({ allowed: true });
    expect(limiter.trackedUsers).toBe(1);
  });

  it("rejects empty identities and invalid clocks", () => {
    const limiter = new MarketDataRateLimiter();
    expect(limiter.consume("", 1_000)).toMatchObject({ allowed: false });
    expect(limiter.consume("user-a", Number.NaN)).toMatchObject({ allowed: false });
  });
});
