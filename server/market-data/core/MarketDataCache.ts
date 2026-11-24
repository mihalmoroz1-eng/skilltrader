import type { MarketDataSnapshot } from "./MarketDataTypes";

type CacheEntry = {
  snapshot: MarketDataSnapshot;
  expiresAt: number;
};

function cloneSnapshot(snapshot: MarketDataSnapshot): MarketDataSnapshot {
  return {
    ...snapshot,
    candles: snapshot.candles.map((candle) => ({ ...candle })),
  };
}

export class MarketDataCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs = 5_000, private readonly maxEntries = 100) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error("ttlMs must be non-negative");
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be positive");
  }

  get(key: string, now = Date.now()): MarketDataSnapshot | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return cloneSnapshot(entry.snapshot);
  }

  set(key: string, snapshot: MarketDataSnapshot, now = Date.now()): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.delete(key);
    this.entries.set(key, {
      snapshot: cloneSnapshot(snapshot),
      expiresAt: now + this.ttlMs,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
