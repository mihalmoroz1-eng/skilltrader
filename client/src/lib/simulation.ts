import { CANDLE_INTERVALS_MS, type CandleTimeframe } from "./candleTimer";

export type Side = "long" | "short";

export type PriceCandle = {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ScenarioResult = {
  trajectories: number[][];
  lowerBand: number[];
  median: number[];
  upperBand: number[];
  targetProbability: number;
  stopProbability: number;
  otherProbability: number;
  trials: number;
};

function createRandom(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function formatCandleTime(timestamp: number, timeframe: CandleTimeframe) {
  const iso = new Date(timestamp).toISOString();
  const clock = iso.slice(11, 16);
  return timeframe === "4ч" ? `${iso.slice(5, 10)} ${clock}Z` : `${clock}Z`;
}

export function buildCandles(
  base: number,
  count = 64,
  seed = 13,
  timeframe: CandleTimeframe = "15м",
  nowMs = Date.now(),
): PriceCandle[] {
  const safeBase = Number.isFinite(base) && base > 0 ? base : 1;
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const safeNow = Number.isFinite(nowMs) ? nowMs : 0;
  const intervalMs = CANDLE_INTERVALS_MS[timeframe];
  const intervalScale = Math.sqrt(intervalMs / CANDLE_INTERVALS_MS["15м"]);
  const random = createRandom(seed);
  const volatility = safeBase * 0.00038 * intervalScale;
  let close = safeBase - safeCount * volatility * 0.12;
  const currentBoundary = Math.floor(safeNow / intervalMs) * intervalMs;

  return Array.from({ length: safeCount }, (_, index) => {
    const timestamp = currentBoundary - (safeCount - index - 1) * intervalMs;
    const open = close;
    const drift = Math.sin(index * 0.31) * volatility * 0.23;
    close = Math.max(safeBase * 0.5, open + (random() - 0.49) * volatility * 2.8 + drift);
    const wick = random() * volatility * 0.8;
    return {
      time: formatCandleTime(timestamp, timeframe),
      timestamp,
      open,
      close,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - random() * volatility * 0.8,
    };
  });
}

export function simulateScenarios(
  entry: number,
  stop: number,
  target: number,
  side: Side,
  trials = 10_000,
  seed = 31,
  steps = 42,
): ScenarioResult {
  const safeEntry = Number.isFinite(entry) && entry > 0 ? entry : 1;
  const stopDistance = Math.abs(safeEntry - stop);
  const targetDistance = Math.abs(target - safeEntry);
  const avgDistance = Math.max((stopDistance + targetDistance) / 2, safeEntry * 0.001);
  const sigma = Math.max(safeEntry * 0.00012, (avgDistance / Math.sqrt(steps)) * 0.72);
  const drift = (side === "long" ? 1 : -1) * sigma * 0.025;
  const random = createRandom(
    seed + Math.round(safeEntry * 100) + Math.round(stop * 7) + Math.round(target * 11),
  );
  const sampleCount = 28;
  const sampledPaths: number[][] = [];
  const valuesByStep = Array.from({ length: steps + 1 }, () => [] as number[]);
  let targetHits = 0;
  let stopHits = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    let price = safeEntry;
    const path = [price];
    valuesByStep[0].push(price);
    let resolved = false;

    for (let step = 1; step <= steps; step += 1) {
      // A centered sum of uniforms approximates a normal shock without a heavy dependency.
      let shock = 0;
      for (let part = 0; part < 6; part += 1) shock += random();
      price = Math.max(safeEntry * 0.35, price + (shock - 3) * sigma + drift);
      valuesByStep[step].push(price);
      path.push(price);

      const hitTarget = side === "long" ? price >= target : price <= target;
      const hitStop = side === "long" ? price <= stop : price >= stop;
      if (hitTarget || hitStop) {
        if (hitTarget) targetHits += 1;
        else stopHits += 1;
        resolved = true;
        for (let rest = step + 1; rest <= steps; rest += 1) valuesByStep[rest].push(price);
        while (path.length <= steps) path.push(price);
        break;
      }
    }

    if (!resolved) {
      for (let rest = path.length; rest <= steps; rest += 1) path.push(price);
    }
    if (trial < sampleCount) sampledPaths.push(path);
  }

  const percentile = (values: number[], percent: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percent))] ?? safeEntry;
  };
  const lowerBand = valuesByStep.map((values) => percentile(values, 0.2));
  const median = valuesByStep.map((values) => percentile(values, 0.5));
  const upperBand = valuesByStep.map((values) => percentile(values, 0.8));
  const otherHits = Math.max(0, trials - targetHits - stopHits);
  const toPercent = (hits: number) => Math.round((hits / trials) * 1000) / 10;

  return {
    trajectories: sampledPaths,
    lowerBand,
    median,
    upperBand,
    targetProbability: toPercent(targetHits),
    stopProbability: toPercent(stopHits),
    otherProbability: toPercent(otherHits),
    trials,
  };
}
