import { describe, expect, it } from "vitest";
import {
  DEMO_JOURNAL_STORAGE_KEY,
  MAX_DEMO_JOURNAL_RECORDS,
  createDemoJournalCsv,
  createDemoJournalRecord,
  filterDemoJournal,
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

function record(index = 1, symbol = "XAUUSD", side: "long" | "short" = "long"): DemoJournalRecord {
  return createDemoJournalRecord({ symbol, side, entry: 2354.2, stop: 2346, target: 2370.5, size: 1 }, `entry-${index}`, "2026-11-19T10:00:00.000Z");
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

  it("filters the journal by ticker and direction without mutating the source", () => {
    const entries = [record(1, "XAUUSD", "long"), record(2, "EURUSD", "short"), record(3, "BTCUSD", "long")];

    expect(filterDemoJournal(entries, " eur ")).toEqual([entries[1]]);
    expect(filterDemoJournal(entries, "", "long")).toEqual([entries[0], entries[2]]);
    expect(filterDemoJournal(entries, "btc", "short")).toEqual([]);
    expect(entries).toHaveLength(3);
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

  it("exports unit metadata in UTF-8 CSV and neutralizes formula-like text", () => {
    const unsafe = record(9, "\t=1+1");
    const csv = createDemoJournalCsv([unsafe]);
    const euroCsv = createDemoJournalCsv([record(10, "EURUSD")]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(";\"Инструмент\";");
    expect(csv).toContain("\"'\t=1+1\"");
    expect(csv).toContain("\"Покупка\"");
    expect(csv).toContain("\"2354,2\"");
    expect(csv).toMatch(/\r\n/);
    expect(euroCsv).toContain("\"Размер\";\"Единица размера\";\"Риск USD\"");
    expect(euroCsv).toContain("\"1\";\"EUR\";");
  });
});
