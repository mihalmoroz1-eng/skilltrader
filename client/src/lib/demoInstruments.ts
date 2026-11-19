export const DEMO_POSITION_SPECS = {
  XAUUSD: { unit: "oz", defaultSize: 1, minSize: 0.01, step: 0.1, fractionDigits: 2 },
  EURUSD: { unit: "EUR", defaultSize: 1_000, minSize: 1, step: 1, fractionDigits: 0 },
  BTCUSD: { unit: "BTC", defaultSize: 0.01, minSize: 0.001, step: 0.001, fractionDigits: 3 },
} as const;

export type DemoInstrumentSymbol = keyof typeof DEMO_POSITION_SPECS;
export type DemoPositionSpec = (typeof DEMO_POSITION_SPECS)[DemoInstrumentSymbol];

const FALLBACK_POSITION_SPEC = {
  unit: "ед.",
  defaultSize: 1,
  minSize: 0.01,
  step: 0.1,
  fractionDigits: 2,
} as const;

export function getDemoPositionSpec(symbol: string): DemoPositionSpec | typeof FALLBACK_POSITION_SPEC {
  if (!Object.prototype.hasOwnProperty.call(DEMO_POSITION_SPECS, symbol)) return FALLBACK_POSITION_SPEC;
  return DEMO_POSITION_SPECS[symbol as DemoInstrumentSymbol];
}

export function formatDemoPositionSize(symbol: string, value: number): string {
  const spec = getDemoPositionSpec(symbol);
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: spec.fractionDigits })} ${spec.unit}`;
}
