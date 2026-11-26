import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import type { HistoricalOrderBookSnapshot } from "./HistoricalOrderBookTypes";

const SCALE = 10n ** 18n;
const MAX_LEVELS = 1000;
const MAX_AGE_MS = 300_000;

export type HistoricalLiquidityCoverage = {
  symbol: string;
  decisionCount: number;
  snapshotCount: number;
  matchedCount: number;
  staleCount: number;
  missingCount: number;
  coveragePct: number;
  averageMatchedAgeMs: number | null;
  maximumMatchedAgeMs: number | null;
  status: "ready" | "partial" | "unavailable";
  lookAheadPrevented: true;
  executionEligible: false;
  exchangeOrderSent: false;
};

export type HistoricalLiquidityFill = {
  symbol: string;
  side: "BUY" | "SELL";
  decisionTime: number;
  status: "filled" | "insufficient_depth" | "stale_snapshot";
  requestedQuantity: string;
  availableQuantity: string;
  filledQuantity: string | null;
  vwap: string | null;
  bestBid: string;
  bestAsk: string;
  midPrice: string;
  spreadBps: string;
  marketImpactBps: string | null;
  snapshotAgeMs: number;
  snapshotDigest: string;
  executionEligible: false;
  exchangeOrderSent: false;
};

function parseFixed(value: string, label: string): bigint {
  if (typeof value !== "string" || value.length > 80 ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) {
    throw new Error(`Invalid decimal value for ${label}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * SCALE + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (result <= 0n) throw new Error(`${label} must be positive`);
  return result;
}

function formatFixed(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function divideFixed(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Division denominator must be positive");
  return (numerator * SCALE + denominator / 2n) / denominator;
}

function multiplyFixed(left: bigint, right: bigint): bigint {
  return (left * right + SCALE / 2n) / SCALE;
}

function ratioBps(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Invalid basis-point denominator");
  return (numerator * 10_000n * SCALE + denominator / 2n) / denominator;
}

function validateSnapshot(snapshot: HistoricalOrderBookSnapshot): void {
  if (!snapshot || !/^[A-Z0-9]{2,20}$/.test(snapshot.symbol) ||
      !Number.isSafeInteger(snapshot.observedAt) || snapshot.observedAt < 0 ||
      !Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt < 0 || snapshot.fetchedAt > snapshot.observedAt ||
      !Array.isArray(snapshot.bids) || !Array.isArray(snapshot.asks) ||
      !Number.isSafeInteger(snapshot.lastUpdateId) || snapshot.lastUpdateId < 0 ||
      typeof snapshot.source !== "string" || !snapshot.source.trim() || snapshot.source.length > 40 ||
      snapshot.bids.length < 1 || snapshot.asks.length < 1 ||
      snapshot.bids.length > MAX_LEVELS || snapshot.asks.length > MAX_LEVELS ||
      snapshot.bidLevels !== snapshot.bids.length || snapshot.askLevels !== snapshot.asks.length ||
      !/^[a-f0-9]{64}$/.test(snapshot.contentDigest)) {
    throw new Error("Historical order-book snapshot metadata is invalid");
  }
  const validateSide = (levels: HistoricalOrderBookSnapshot["bids"], side: "bid" | "ask") => {
    let previous: bigint | null = null;
    for (const level of levels) {
      const price = parseFixed(level.price, "price");
      parseFixed(level.quantity, "quantity");
      if (previous !== null && (side === "bid" ? price > previous : price < previous)) {
        throw new Error("Historical order-book levels are not sorted");
      }
      previous = price;
    }
  };
  validateSide(snapshot.bids, "bid");
  validateSide(snapshot.asks, "ask");
  if (snapshot.bestBid !== snapshot.bids[0].price || snapshot.bestAsk !== snapshot.asks[0].price ||
      parseFixed(snapshot.bids[0].price, "best bid") >= parseFixed(snapshot.asks[0].price, "best ask")) {
    throw new Error("Historical order book is crossed");
  }
}

/** Measures archived depth available no later than each next-candle-open decision timestamp. */
export function analyzeHistoricalLiquidityCoverage(
  symbol: string,
  candles: readonly MarketCandle[],
  snapshots: readonly HistoricalOrderBookSnapshot[],
  maxAgeMs = 30_000,
): HistoricalLiquidityCoverage {
  if (!/^[A-Z0-9]{2,20}$/.test(symbol) || candles.length < 1 || candles.length > 50_000 ||
      !Number.isInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > MAX_AGE_MS) {
    throw new Error("Invalid historical liquidity coverage request");
  }
  let previousDecision = -1;
  for (const candle of candles) {
    if (!Number.isSafeInteger(candle.openTime) || candle.openTime <= previousDecision) {
      throw new Error("Coverage candles must have strictly increasing open timestamps");
    }
    previousDecision = candle.openTime;
  }
  let previousSnapshot = -1;
  for (const snapshot of snapshots) {
    validateSnapshot(snapshot);
    if (snapshot.symbol !== symbol || snapshot.observedAt <= previousSnapshot) {
      throw new Error("Coverage snapshots must match the symbol and be strictly time ordered");
    }
    previousSnapshot = snapshot.observedAt;
  }

  let cursor = 0;
  let latest: HistoricalOrderBookSnapshot | null = null;
  let matchedCount = 0;
  let staleCount = 0;
  let missingCount = 0;
  let ageTotal = 0;
  let maximumAge = 0;
  for (const candle of candles) {
    while (cursor < snapshots.length && snapshots[cursor].observedAt <= candle.openTime) {
      latest = snapshots[cursor];
      cursor += 1;
    }
    if (!latest) {
      missingCount += 1;
      continue;
    }
    const age = candle.openTime - latest.observedAt;
    if (age < 0) throw new Error("Look-ahead snapshot detected");
    if (age > maxAgeMs) {
      staleCount += 1;
      continue;
    }
    matchedCount += 1;
    ageTotal += age;
    maximumAge = Math.max(maximumAge, age);
  }
  const decisionCount = candles.length;
  const coveragePct = matchedCount / decisionCount * 100;
  return {
    symbol, decisionCount, snapshotCount: snapshots.length,
    matchedCount, staleCount, missingCount, coveragePct,
    averageMatchedAgeMs: matchedCount ? ageTotal / matchedCount : null,
    maximumMatchedAgeMs: matchedCount ? maximumAge : null,
    status: matchedCount === decisionCount ? "ready" : matchedCount > 0 ? "partial" : "unavailable",
    lookAheadPrevented: true, executionEligible: false, exchangeOrderSent: false,
  };
}

/** Walks asks for BUY and bids for SELL. Partial depth is never reported as a completed fill. */
export function simulateHistoricalLiquidityFill(input: {
  snapshot: HistoricalOrderBookSnapshot;
  decisionTime: number;
  side: "BUY" | "SELL";
  requestedQuantity: string;
  maxAgeMs?: number;
}): HistoricalLiquidityFill {
  const { snapshot, decisionTime, side } = input;
  const maxAgeMs = input.maxAgeMs ?? 30_000;
  validateSnapshot(snapshot);
  const requested = parseFixed(input.requestedQuantity, "requested quantity");
  if (!Number.isSafeInteger(decisionTime) || decisionTime < snapshot.observedAt ||
      !Number.isInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > MAX_AGE_MS ||
      (side !== "BUY" && side !== "SELL")) {
    throw new Error("Invalid historical liquidity fill request");
  }
  const snapshotAgeMs = decisionTime - snapshot.observedAt;
  const bestBid = parseFixed(snapshot.bids[0].price, "best bid");
  const bestAsk = parseFixed(snapshot.asks[0].price, "best ask");
  const midPrice = (bestBid + bestAsk) / 2n;
  const spreadBps = ratioBps(bestAsk - bestBid, midPrice);
  const levels = side === "BUY" ? snapshot.asks : snapshot.bids;
  let available = 0n;
  let remaining = requested;
  let notional = 0n;
  for (const level of levels) {
    const levelQuantity = parseFixed(level.quantity, "level quantity");
    const levelPrice = parseFixed(level.price, "level price");
    available += levelQuantity;
    if (remaining === 0n) continue;
    const consumed = remaining < levelQuantity ? remaining : levelQuantity;
    notional += multiplyFixed(levelPrice, consumed);
    remaining -= consumed;
  }
  const common = {
    symbol: snapshot.symbol, side, decisionTime, requestedQuantity: formatFixed(requested),
    availableQuantity: formatFixed(available), bestBid: formatFixed(bestBid),
    bestAsk: formatFixed(bestAsk), midPrice: formatFixed(midPrice),
    spreadBps: formatFixed(spreadBps), snapshotAgeMs,
    snapshotDigest: snapshot.contentDigest, executionEligible: false as const,
    exchangeOrderSent: false as const,
  };
  if (snapshotAgeMs > maxAgeMs) {
    return { ...common, status: "stale_snapshot", filledQuantity: null, vwap: null, marketImpactBps: null };
  }
  if (remaining > 0n) {
    return { ...common, status: "insufficient_depth", filledQuantity: null, vwap: null, marketImpactBps: null };
  }
  const vwap = divideFixed(notional, requested);
  const impactNumerator = side === "BUY" ? vwap - midPrice : midPrice - vwap;
  const marketImpactBps = ratioBps(impactNumerator < 0n ? 0n : impactNumerator, midPrice);
  return {
    ...common, status: "filled", filledQuantity: formatFixed(requested),
    vwap: formatFixed(vwap), marketImpactBps: formatFixed(marketImpactBps),
  };
}
