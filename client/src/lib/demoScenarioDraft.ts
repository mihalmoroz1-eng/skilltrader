import type { CandleTimeframe } from "./candleTimer";
import { DEMO_POSITION_SPECS, type DemoInstrumentSymbol } from "./demoInstruments";
import type { Side } from "./simulation";

export const DEMO_SCENARIO_DRAFT_STORAGE_KEY = "skill-trader:scenario-draft:v1";
export const DEMO_SCENARIO_SYMBOLS = Object.keys(DEMO_POSITION_SPECS) as DemoInstrumentSymbol[];
export type DemoScenarioSymbol = DemoInstrumentSymbol;

const TIMEFRAMES: readonly CandleTimeframe[] = ["15м", "1ч", "4ч"];
const MAX_SCENARIO_VALUE = 1_000_000_000;
const MAX_POSITION_SIZE = 1_000_000;

type DemoDraftStorage = Pick<Storage, "getItem" | "setItem">;

export type DemoScenarioDraft = {
  symbol: DemoScenarioSymbol;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  size: number;
  timeframe: CandleTimeframe;
};

export const DEFAULT_DEMO_SCENARIO_DRAFT: Readonly<DemoScenarioDraft> = Object.freeze({
  symbol: "XAUUSD",
  side: "long",
  entry: 2354.2,
  stop: 2346,
  target: 2370.5,
  size: 1,
  timeframe: "15м",
});

function getBrowserStorage(): DemoDraftStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isDemoScenarioSymbol(value: unknown): value is DemoScenarioSymbol {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEMO_POSITION_SPECS, value);
}

export function isValidDemoScenarioDraft(value: unknown): value is DemoScenarioDraft {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isDemoScenarioSymbol(candidate.symbol)) return false;

  return (
    (candidate.side === "long" || candidate.side === "short") &&
    isBoundedNumber(candidate.entry, Number.MIN_VALUE, MAX_SCENARIO_VALUE) &&
    isBoundedNumber(candidate.stop, Number.MIN_VALUE, MAX_SCENARIO_VALUE) &&
    isBoundedNumber(candidate.target, Number.MIN_VALUE, MAX_SCENARIO_VALUE) &&
    isBoundedNumber(candidate.size, DEMO_POSITION_SPECS[candidate.symbol].minSize, MAX_POSITION_SIZE) &&
    TIMEFRAMES.includes(candidate.timeframe as CandleTimeframe)
  );
}

export function readDemoScenarioDraft(storage?: DemoDraftStorage): DemoScenarioDraft {
  const source = storage ?? getBrowserStorage();
  if (!source) return { ...DEFAULT_DEMO_SCENARIO_DRAFT };

  try {
    const raw = source.getItem(DEMO_SCENARIO_DRAFT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DEMO_SCENARIO_DRAFT };
    const parsed: unknown = JSON.parse(raw);
    return isValidDemoScenarioDraft(parsed) ? { ...parsed } : { ...DEFAULT_DEMO_SCENARIO_DRAFT };
  } catch {
    return { ...DEFAULT_DEMO_SCENARIO_DRAFT };
  }
}

export function writeDemoScenarioDraft(draft: DemoScenarioDraft, storage?: DemoDraftStorage): boolean {
  if (!isValidDemoScenarioDraft(draft)) return false;
  const source = storage ?? getBrowserStorage();
  if (!source) return false;

  try {
    source.setItem(DEMO_SCENARIO_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
