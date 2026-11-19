import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEMO_SCENARIO_DRAFT,
  DEMO_SCENARIO_DRAFT_STORAGE_KEY,
  isValidDemoScenarioDraft,
  readDemoScenarioDraft,
  writeDemoScenarioDraft,
} from "../client/src/lib/demoScenarioDraft";

 type MemoryStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; value: string | null };

function createMemoryStorage(initial: string | null = null): MemoryStorage {
  return {
    value: initial,
    getItem(key) { return key === DEMO_SCENARIO_DRAFT_STORAGE_KEY ? this.value : null; },
    setItem(key, value) { if (key === DEMO_SCENARIO_DRAFT_STORAGE_KEY) this.value = value; },
  };
}

const validDraft = {
  symbol: "BTCUSD",
  side: "short",
  entry: 67420.5,
  stop: 68000,
  target: 66000,
  size: 0.5,
  timeframe: "4ч",
} as const;

describe("local demo scenario draft", () => {
  it("uses the safe XAUUSD defaults when nothing is stored", () => {
    expect(readDemoScenarioDraft(createMemoryStorage())).toEqual(DEFAULT_DEMO_SCENARIO_DRAFT);
  });

  it("persists and restores the selected symbol, side, levels, size and timeframe", () => {
    const storage = createMemoryStorage();

    expect(writeDemoScenarioDraft(validDraft, storage)).toBe(true);
    expect(readDemoScenarioDraft(storage)).toEqual(validDraft);
  });

  it("accepts known symbols and intervals but rejects unknown or unsafe values", () => {
    expect(isValidDemoScenarioDraft(validDraft)).toBe(true);
    expect(isValidDemoScenarioDraft({ ...validDraft, symbol: "DOGEUSD" })).toBe(false);
    expect(isValidDemoScenarioDraft({ ...validDraft, timeframe: "1д" })).toBe(false);
    expect(isValidDemoScenarioDraft({ ...validDraft, entry: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidDemoScenarioDraft({ ...validDraft, size: 0 })).toBe(false);
  });

  it("falls back to defaults when the stored JSON is corrupt, partial or invalid", () => {
    expect(readDemoScenarioDraft(createMemoryStorage("not-json"))).toEqual(DEFAULT_DEMO_SCENARIO_DRAFT);
    expect(readDemoScenarioDraft(createMemoryStorage(JSON.stringify({ symbol: "EURUSD" })))).toEqual(DEFAULT_DEMO_SCENARIO_DRAFT);
    expect(readDemoScenarioDraft(createMemoryStorage(JSON.stringify({ ...validDraft, stop: -1 })))).toEqual(DEFAULT_DEMO_SCENARIO_DRAFT);
  });

  it("reports storage failures instead of claiming persistence", () => {
    const failingStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(writeDemoScenarioDraft(validDraft, failingStorage)).toBe(false);
    expect(writeDemoScenarioDraft({ ...validDraft, size: 0 }, createMemoryStorage())).toBe(false);
    expect(readDemoScenarioDraft({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined })).toEqual(DEFAULT_DEMO_SCENARIO_DRAFT);
  });
});
