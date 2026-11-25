import type { MarketDataSnapshot } from "./MarketDataTypes";

type CacheEntry = {
  snapshot: MarketDataSnapshot;
  expiresAt: number;
};

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Cache timestamp must be a non-negative safe integer");
  }
}

function cloneSnapshot(snapshot: MarketDataSnapshot): MarketDataSnapshot {
  return {
    ...snapshot,
    candles: snapshot.candles.map((candle) => ({ ...candle })),
  };
}

export class MarketDataCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs = 5_000, private readonly maxEntries = 100) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) throw new Error("ttlMs must be a non-negative safe integer");
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be a positive safe integer");
  }

  get(key: string, now = Date.now()): MarketDataSnapshot | null {
    assertTimestamp(now);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return cloneSnapshot(entry.snapshot);
  }

  set(key: string, snapshot: MarketDataSnapshot, now = Date.now()): void {
    assertTimestamp(now);
    const expiresAt = now + this.ttlMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new RangeError("Cache expiration timestamp exceeds the safe integer range");
    }
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.delete(key);
    this.entries.set(key, {
      snapshot: cloneSnapshot(snapshot),
      expiresAt,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
