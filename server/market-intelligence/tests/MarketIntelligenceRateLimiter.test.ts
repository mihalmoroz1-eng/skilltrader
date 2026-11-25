import { describe, expect, it } from "vitest";
import { MarketIntelligenceRateLimiter } from "../core/MarketIntelligenceRateLimiter";

describe("market intelligence rate limiter", () => {
  it("allows two starts per minute and calculates retry time", () => {
    const limiter = new MarketIntelligenceRateLimiter(2, 10, 5);
    expect(limiter.consume("user-a", 1_000)).toEqual({ allowed: true });
    expect(limiter.consume("user-a", 1_001)).toEqual({ allowed: true });
    expect(limiter.consume("user-a", 1_002)).toMatchObject({
      allowed: false,
      scope: "minute",
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("user-a", 61_001)).toEqual({ allowed: true });
  });

  it("enforces a daily request limit", () => {
    const limiter = new MarketIntelligenceRateLimiter(100, 2, 5);
    const day = Date.UTC(2026, 10, 24);
    const midday = day + 43_200_001;
    expect(limiter.consume("user-a", midday)).toEqual({ allowed: true });
    expect(limiter.consume("user-a", midday + 1)).toEqual({ allowed: true });
    expect(limiter.consume("user-a", midday + 2)).toMatchObject({
      allowed: false,
      scope: "day",
      retryAfterSeconds: 43_200,
    });
    expect(limiter.consume("user-a", day + 86_400_000 + 1)).toEqual({ allowed: true });
  });

  it("bounds tracked users and rejects invalid identities", () => {
    const limiter = new MarketIntelligenceRateLimiter(100, 100, 1);
    expect(limiter.consume("user-a", 1_000)).toEqual({ allowed: true });
    expect(limiter.consume("user-b", 1_001)).toMatchObject({ allowed: false, scope: "capacity" });
    expect(limiter.consume("", 1_002)).toMatchObject({ allowed: false });
  });
});
