import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEMO_ACCOUNT_SETTINGS,
  DEMO_ACCOUNT_SETTINGS_STORAGE_KEY,
  DEMO_BALANCE_MAX_USD,
  DEMO_BALANCE_MIN_USD,
  DEMO_RISK_MAX_PERCENT,
  DEMO_RISK_MIN_PERCENT,
  isValidDemoAccountSettings,
  readDemoAccountSettings,
  writeDemoAccountSettings,
} from "../client/src/lib/demoAccountSettings";

type MemoryStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; value: string | null };

function createMemoryStorage(initial: string | null = null): MemoryStorage {
  return {
    value: initial,
    getItem(key) { return key === DEMO_ACCOUNT_SETTINGS_STORAGE_KEY ? this.value : null; },
    setItem(key, value) { if (key === DEMO_ACCOUNT_SETTINGS_STORAGE_KEY) this.value = value; },
  };
}

describe("local demo account settings", () => {
  it("uses the $500 / 2% defaults when nothing is stored", () => {
    expect(readDemoAccountSettings(createMemoryStorage())).toEqual({ balanceUsd: 500, riskLimitPercent: 2 });
    expect(DEFAULT_DEMO_ACCOUNT_SETTINGS).toEqual({ balanceUsd: 500, riskLimitPercent: 2 });
  });

  it("persists and restores valid settings from browser-local storage", () => {
    const storage = createMemoryStorage();
    const settings = { balanceUsd: 1250.5, riskLimitPercent: 1.5 };

    expect(writeDemoAccountSettings(settings, storage)).toBe(true);
    expect(readDemoAccountSettings(storage)).toEqual(settings);
  });

  it("accepts the declared boundary values and rejects out-of-range settings", () => {
    expect(isValidDemoAccountSettings({ balanceUsd: DEMO_BALANCE_MIN_USD, riskLimitPercent: DEMO_RISK_MIN_PERCENT })).toBe(true);
    expect(isValidDemoAccountSettings({ balanceUsd: DEMO_BALANCE_MAX_USD, riskLimitPercent: DEMO_RISK_MAX_PERCENT })).toBe(true);
    expect(isValidDemoAccountSettings({ balanceUsd: 0, riskLimitPercent: 2 })).toBe(false);
    expect(isValidDemoAccountSettings({ balanceUsd: 500, riskLimitPercent: 10.1 })).toBe(false);
  });

  it("falls back to defaults for corrupted, partial or invalid stored data", () => {
    expect(readDemoAccountSettings(createMemoryStorage("not-json"))).toEqual(DEFAULT_DEMO_ACCOUNT_SETTINGS);
    expect(readDemoAccountSettings(createMemoryStorage(JSON.stringify({ balanceUsd: 700 })))).toEqual(DEFAULT_DEMO_ACCOUNT_SETTINGS);
    expect(readDemoAccountSettings(createMemoryStorage(JSON.stringify({ balanceUsd: -5, riskLimitPercent: 200 })))).toEqual(DEFAULT_DEMO_ACCOUNT_SETTINGS);
  });

  it("reports storage failures instead of claiming a persistent save", () => {
    const failingStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(writeDemoAccountSettings({ balanceUsd: 700, riskLimitPercent: 1.5 }, failingStorage)).toBe(false);
    expect(writeDemoAccountSettings({ balanceUsd: 0, riskLimitPercent: 1 }, createMemoryStorage())).toBe(false);
  });
});
