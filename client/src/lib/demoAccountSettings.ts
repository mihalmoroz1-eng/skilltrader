export type DemoAccountSettings = {
  balanceUsd: number;
  riskLimitPercent: number;
};

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export const DEMO_ACCOUNT_SETTINGS_STORAGE_KEY = "skill-trader:demo-account-settings:v1";
export const DEMO_BALANCE_MIN_USD = 1;
export const DEMO_BALANCE_MAX_USD = 1_000_000_000;
export const DEMO_RISK_MIN_PERCENT = 0.1;
export const DEMO_RISK_MAX_PERCENT = 10;
export const DEFAULT_DEMO_ACCOUNT_SETTINGS: Readonly<DemoAccountSettings> = Object.freeze({
  balanceUsd: 500,
  riskLimitPercent: 2,
});

function getBrowserStorage(): SettingsStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function isValidDemoAccountSettings(value: unknown): value is DemoAccountSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<DemoAccountSettings>;
  return (
    typeof settings.balanceUsd === "number" && Number.isFinite(settings.balanceUsd) &&
    settings.balanceUsd >= DEMO_BALANCE_MIN_USD && settings.balanceUsd <= DEMO_BALANCE_MAX_USD &&
    typeof settings.riskLimitPercent === "number" && Number.isFinite(settings.riskLimitPercent) &&
    settings.riskLimitPercent >= DEMO_RISK_MIN_PERCENT && settings.riskLimitPercent <= DEMO_RISK_MAX_PERCENT
  );
}

export function readDemoAccountSettings(storage: SettingsStorage | undefined = getBrowserStorage()): DemoAccountSettings {
  if (!storage) return { ...DEFAULT_DEMO_ACCOUNT_SETTINGS };
  try {
    const raw = storage.getItem(DEMO_ACCOUNT_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DEMO_ACCOUNT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    return isValidDemoAccountSettings(parsed) ? { ...parsed } : { ...DEFAULT_DEMO_ACCOUNT_SETTINGS };
  } catch {
    return { ...DEFAULT_DEMO_ACCOUNT_SETTINGS };
  }
}

export function writeDemoAccountSettings(
  settings: DemoAccountSettings,
  storage: SettingsStorage | undefined = getBrowserStorage(),
): boolean {
  if (!storage || !isValidDemoAccountSettings(settings)) return false;
  try {
    storage.setItem(DEMO_ACCOUNT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
