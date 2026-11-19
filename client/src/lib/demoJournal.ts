import { getDemoPositionSpec } from "./demoInstruments";

export type DemoJournalSide = "long" | "short";

export type DemoJournalInput = {
  symbol: string;
  side: DemoJournalSide;
  entry: number;
  stop: number;
  target: number;
  size: number;
};

export type DemoJournalRecord = DemoJournalInput & {
  id: string;
  createdAt: string;
  riskUsd: number;
  potentialUsd: number;
  riskReward: number;
};

type JournalStorage = Pick<Storage, "getItem" | "setItem">;

export const DEMO_JOURNAL_STORAGE_KEY = "skill-trader:demo-journal:v1";
export const MAX_DEMO_JOURNAL_RECORDS = 50;

function getBrowserStorage(): JournalStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isDemoJournalRecord(value: unknown): value is DemoJournalRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DemoJournalRecord>;
  return (
    typeof record.id === "string" && record.id.length > 0 &&
    typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt)) &&
    typeof record.symbol === "string" && record.symbol.length > 0 &&
    (record.side === "long" || record.side === "short") &&
    isFinitePositive(record.entry) && isFinitePositive(record.stop) && isFinitePositive(record.target) &&
    isFinitePositive(record.size) &&
    typeof record.riskUsd === "number" && Number.isFinite(record.riskUsd) && record.riskUsd >= 0 &&
    typeof record.potentialUsd === "number" && Number.isFinite(record.potentialUsd) && record.potentialUsd >= 0 &&
    typeof record.riskReward === "number" && Number.isFinite(record.riskReward) && record.riskReward >= 0
  );
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}

export function createDemoJournalRecord(
  input: DemoJournalInput,
  id = createId(),
  createdAt = new Date().toISOString(),
): DemoJournalRecord {
  const riskUsd = roundToCents(Math.abs(input.entry - input.stop) * input.size);
  const potentialUsd = roundToCents(Math.abs(input.target - input.entry) * input.size);
  const riskReward = riskUsd > 0 ? Math.round((potentialUsd / riskUsd) * 100) / 100 : 0;
  const record: DemoJournalRecord = { ...input, id, createdAt, riskUsd, potentialUsd, riskReward };
  if (!isDemoJournalRecord(record)) throw new Error("Некорректные параметры демо-сценария");
  return record;
}

export function readDemoJournal(storage: JournalStorage | undefined = getBrowserStorage()): DemoJournalRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DEMO_JOURNAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDemoJournalRecord).slice(0, MAX_DEMO_JOURNAL_RECORDS);
  } catch {
    return [];
  }
}

export function writeDemoJournal(
  records: DemoJournalRecord[],
  storage: JournalStorage | undefined = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  const safeRecords = records.filter(isDemoJournalRecord).slice(0, MAX_DEMO_JOURNAL_RECORDS);
  try {
    storage.setItem(DEMO_JOURNAL_STORAGE_KEY, JSON.stringify(safeRecords));
    return true;
  } catch {
    return false;
  }
}

export function canAccessDemoJournalStorage(storage: JournalStorage | undefined = getBrowserStorage()) {
  if (!storage) return false;
  try {
    storage.getItem(DEMO_JOURNAL_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export type DemoJournalSideFilter = "all" | DemoJournalSide;

export function filterDemoJournal(
  records: DemoJournalRecord[],
  search: string,
  side: DemoJournalSideFilter = "all",
): DemoJournalRecord[] {
  const query = search.trim().toLocaleLowerCase("ru-RU");
  return records.filter((record) => {
    const matchesSymbol = !query || record.symbol.toLocaleLowerCase("ru-RU").includes(query);
    const matchesSide = side === "all" || record.side === side;
    return matchesSymbol && matchesSide;
  });
}

const CSV_HEADERS = [
  "Дата и время",
  "Инструмент",
  "Направление",
  "Вход",
  "Стоп",
  "Цель",
  "Размер",
  "Единица размера",
  "Риск USD",
  "Потенциал USD",
  "Прибыль/риск",
];

function spreadsheetSafeText(value: string) {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number) {
  const text = typeof value === "number"
    ? value.toLocaleString("ru-RU", { useGrouping: false, maximumFractionDigits: 8 })
    : spreadsheetSafeText(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function createDemoJournalCsv(records: DemoJournalRecord[]): string {
  const rows = records.map((record) => [
    record.createdAt,
    record.symbol,
    record.side === "long" ? "Покупка" : "Продажа",
    record.entry,
    record.stop,
    record.target,
    record.size,
    getDemoPositionSpec(record.symbol).unit,
    record.riskUsd,
    record.potentialUsd,
    record.riskReward,
  ]);
  return `\uFEFF${[CSV_HEADERS, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export function downloadDemoJournalCsv(records: DemoJournalRecord[], now = new Date()): boolean {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return false;
  let objectUrl = "";
  try {
    const blob = new Blob([createDemoJournalCsv(records)], { type: "text/csv;charset=utf-8" });
    objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `skill-trader-journal-${now.toISOString().slice(0, 10)}.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    return true;
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return false;
  }
}
