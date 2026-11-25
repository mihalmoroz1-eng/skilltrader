export type MarketDataRateLimitDecision =
  | { allowed: true }
  | { allowed: false; scope: "minute" | "capacity"; retryAfterSeconds: number };

const DEFAULT_REQUESTS_PER_MINUTE = 20;
const DEFAULT_MAX_TRACKED_USERS = 10_000;
const RATE_WINDOW_MS = 60_000;

export class MarketDataRateLimiter {
  private readonly requestsByUser = new Map<string, number[]>();
  private lastCleanupMs = 0;

  constructor(
    private readonly requestsPerMinute = DEFAULT_REQUESTS_PER_MINUTE,
    private readonly maxTrackedUsers = DEFAULT_MAX_TRACKED_USERS,
  ) {
    if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1) {
      throw new Error("requestsPerMinute must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxTrackedUsers) || maxTrackedUsers < 1) {
      throw new Error("maxTrackedUsers must be a positive safe integer");
    }
  }

  private cleanup(nowMs: number): void {
    if (nowMs >= this.lastCleanupMs && nowMs - this.lastCleanupMs < RATE_WINDOW_MS) return;
    this.lastCleanupMs = nowMs;
    const cutoff = nowMs - RATE_WINDOW_MS;
    for (const [userKey, timestamps] of this.requestsByUser) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff && timestamp <= nowMs);
      if (recent.length > 0) this.requestsByUser.set(userKey, recent);
      else this.requestsByUser.delete(userKey);
    }
  }

  consume(userKey: string, nowMs = Date.now()): MarketDataRateLimitDecision {
    const normalizedKey = typeof userKey === "string" ? userKey.trim() : "";
    if (!normalizedKey || !Number.isSafeInteger(nowMs) || nowMs < 0) {
      return { allowed: false, scope: "minute", retryAfterSeconds: 60 };
    }

    this.cleanup(nowMs);
    if (!this.requestsByUser.has(normalizedKey) && this.requestsByUser.size >= this.maxTrackedUsers) {
      return { allowed: false, scope: "capacity", retryAfterSeconds: 60 };
    }

    const cutoff = nowMs - RATE_WINDOW_MS;
    const recent = (this.requestsByUser.get(normalizedKey) ?? [])
      .filter((timestamp) => timestamp > cutoff && timestamp <= nowMs);

    if (recent.length >= this.requestsPerMinute) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((recent[0] + RATE_WINDOW_MS - nowMs) / 1_000),
      );
      this.requestsByUser.set(normalizedKey, recent);
      return { allowed: false, scope: "minute", retryAfterSeconds };
    }

    recent.push(nowMs);
    this.requestsByUser.set(normalizedKey, recent);
    return { allowed: true };
  }

  get trackedUsers(): number {
    return this.requestsByUser.size;
  }
}

export const marketDataRateLimiter = new MarketDataRateLimiter();
