export type MarketIntelligenceRateLimitDecision =
  | { allowed: true }
  | { allowed: false; scope: "minute" | "day" | "capacity"; retryAfterSeconds: number };

type DailyState = { day: string; count: number };

const WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;
const CLEANUP_INTERVAL_MS = WINDOW_MS;

/** Process-local guard for expensive multi-agent calls; not a distributed quota. */
export class MarketIntelligenceRateLimiter {
  private readonly minuteByUser = new Map<string, number[]>();
  private readonly dailyByUser = new Map<string, DailyState>();
  private lastCleanupMs = 0;
  private lastCleanupDay = "";

  constructor(
    private readonly requestsPerMinute = 2,
    private readonly requestsPerUtcDay = 20,
    private readonly maxTrackedUsers = 10_000,
  ) {
    if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1) {
      throw new Error("requestsPerMinute must be a positive safe integer");
    }
    if (!Number.isSafeInteger(requestsPerUtcDay) || requestsPerUtcDay < 1) {
      throw new Error("requestsPerUtcDay must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxTrackedUsers) || maxTrackedUsers < 1) {
      throw new Error("maxTrackedUsers must be a positive safe integer");
    }
  }

  private cleanup(nowMs: number, day: string): void {
    if (this.lastCleanupDay === day && nowMs >= this.lastCleanupMs && nowMs - this.lastCleanupMs < CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastCleanupMs = nowMs;
    this.lastCleanupDay = day;

    const cutoff = nowMs - WINDOW_MS;
    for (const [key, timestamps] of this.minuteByUser) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff && timestamp <= nowMs);
      if (recent.length > 0) this.minuteByUser.set(key, recent);
      else this.minuteByUser.delete(key);
    }
    for (const [key, state] of this.dailyByUser) {
      if (state.day !== day) this.dailyByUser.delete(key);
    }
  }

  consume(userKey: string, nowMs = Date.now()): MarketIntelligenceRateLimitDecision {
    const key = typeof userKey === "string" ? userKey.trim() : "";
    if (!key || !Number.isSafeInteger(nowMs) || nowMs < 0) {
      return { allowed: false, scope: "minute", retryAfterSeconds: 60 };
    }

    const day = new Date(nowMs).toISOString().slice(0, 10);
    this.cleanup(nowMs, day);

    const daily = this.dailyByUser.get(key);
    if ((!daily || daily.day !== day) && this.dailyByUser.size >= this.maxTrackedUsers) {
      return { allowed: false, scope: "capacity", retryAfterSeconds: 60 };
    }

    const dailyState = daily?.day === day ? daily : { day, count: 0 };
    if (dailyState.count >= this.requestsPerUtcDay) {
      return { allowed: false, scope: "day", retryAfterSeconds: 86_400 };
    }

    const recent = this.minuteByUser.get(key) ?? [];
    if (recent.length >= this.requestsPerMinute) {
      return {
        allowed: false,
        scope: "minute",
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - nowMs) / 1_000)),
      };
    }

    recent.push(nowMs);
    this.minuteByUser.set(key, recent);
    this.dailyByUser.set(key, { day, count: dailyState.count + 1 });
    return { allowed: true };
  }

  get trackedUsers(): number {
    return this.dailyByUser.size;
  }
}

export const marketIntelligenceRateLimiter = new MarketIntelligenceRateLimiter();
