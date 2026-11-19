import { describe, expect, it } from "vitest";
import {
  DEMO_JOURNAL_STORAGE_KEY,
  MAX_DEMO_JOURNAL_RECORDS,
  createDemoJournalRecord,
  readDemoJournal,
  writeDemoJournal,
  type DemoJournalRecord,
} from "../client/src/lib/demoJournal";

type MemoryStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; value: string | null };

function createMemoryStorage(initial: string | null = null): MemoryStorage {
  return {
    value: initial,
    getItem(key) { return key === DEMO_JOURNAL_STORAGE_KEY ? this.value : null; },
    setItem(key, value) { if (key === DEMO_JOURNAL_STORAGE_KEY) this.value = value; },
  };
}

function record(index = 1): DemoJournalRecord {
  return createDemoJournalRecord({ symbol: "XAUUSD", side: "long", entry: 2354.2, stop: 2346, target: 2370.5, size: 1 }, `entry-${index}`, "2026-11-19T10:00:00.000Z");
}

describe("local demo journal", () => {
  it("stores the scenario snapshot and derives risk/reward values", () => {
    const entry = record();
    expect(entry.id).toBe("entry-1");
    expect(entry.riskUsd).toBeCloseTo(8.2, 2);
    expect(entry.potentialUsd).toBeCloseTo(16.3, 2);
    expect(entry.riskReward).toBe(1.99);
  });

  it("persists and restores records using the browser-local storage contract", () => {
    const storage = createMemoryStorage();
    const entries = [record(1), record(2)];

    expect(writeDemoJournal(entries, storage)).toBe(true);
    expect(readDemoJournal(storage)).toEqual(entries);
  });

  it("filters malformed records and caps retained history at fifty", () => {
    const entries = Array.from({ length: MAX_DEMO_JOURNAL_RECORDS + 3 }, (_, index) => record(index));
    const storage = createMemoryStorage(JSON.stringify([null, { symbol: "invalid" }, ...entries]));

    expect(readDemoJournal(storage)).toHaveLength(MAX_DEMO_JOURNAL_RECORDS);
    expect(readDemoJournal(createMemoryStorage("not-json"))).toEqual([]);
  });

  it("does not claim success when browser storage throws", () => {
    const failingStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(writeDemoJournal([record()], failingStorage)).toBe(false);
  });
});
