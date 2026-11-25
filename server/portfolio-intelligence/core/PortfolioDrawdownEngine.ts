import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import type { PortfolioIntelligenceResult } from "./PortfolioIntelligenceEngine";

const MIN_DRAWDOWN_OBSERVATIONS = 30;
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};
function step(interval: MarketInterval, time: number): number {
  if (interval === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - time;
  }
  return INTERVAL_MS[interval] ?? 0;
}

export type PortfolioDrawdownIntelligenceResult = {
  status: "ready" | "insufficient_data" | "no_exposure" | "stale_marks";
  method: "historical_static_current_exposure";
  observations: number;
  maxDrawdownPct: number | null;
  currentDrawdownPct: number | null;
  maxDrawdownDurationObservations: number | null;
  currentDrawdownDurationObservations: number | null;
  maxDrawdownRecovered: boolean | null;
};

function empty(status: PortfolioDrawdownIntelligenceResult["status"], observations = 0): PortfolioDrawdownIntelligenceResult {
  return {
    status, method: "historical_static_current_exposure", observations,
    maxDrawdownPct: null, currentDrawdownPct: null,
    maxDrawdownDurationObservations: null, currentDrawdownDurationObservations: null,
    maxDrawdownRecovered: null,
  };
}

/**
 * Reconstructs a historical return path using today's signed net exposure weights.
 * This is a static-weight approximation, not the account's historical NAV.
 */
export function calculatePortfolioDrawdown(
  interval: MarketInterval,
  series: Map<string, MarketCandle[]>,
  portfolio: PortfolioIntelligenceResult["portfolio"],
): PortfolioDrawdownIntelligenceResult {
  if (!portfolio.accountAvailable || portfolio.openPositions === 0) return empty("no_exposure");
  if (!portfolio.markToMarketAvailable || !portfolio.grossExposure) return empty("stale_marks");
  const gross = Number(portfolio.grossExposure);
  if (!Number.isFinite(gross) || gross <= 0) return empty("no_exposure");
  const holdings = portfolio.symbolExposure;
  if (!holdings.length || holdings.some(item => !series.has(item.symbol))) return empty("insufficient_data");

  const closeMaps = holdings.map(holding => ({
    closes: new Map((series.get(holding.symbol) ?? []).map(candle => [candle.openTime, Number(candle.close)] as const)),
    weight: itemNet(holding.netNotional) / gross,
  }));
  const commonCandleTimes = [...closeMaps[0].closes.keys()]
    .filter(time => closeMaps.every(item => item.closes.has(time)))
    .sort((a, b) => a - b);
  let portfolioReturns: number[] = [];
  let contiguousReturns: number[] = [];
  for (let i = 1; i < commonCandleTimes.length; i += 1) {
    const previous = commonCandleTimes[i - 1], current = commonCandleTimes[i];
    if (current !== previous + step(interval, previous)) {
      if (contiguousReturns.length > portfolioReturns.length) portfolioReturns = contiguousReturns;
      contiguousReturns = [];
      continue;
    }
    const value = closeMaps.reduce((sum, item) => {
      const oldClose = item.closes.get(previous)!;
      const newClose = item.closes.get(current)!;
      return sum + item.weight * ((newClose - oldClose) / oldClose);
    }, 0);
    if (Number.isFinite(value)) contiguousReturns.push(value);
  }
  if (contiguousReturns.length > portfolioReturns.length) portfolioReturns = contiguousReturns;
  if (portfolioReturns.length < MIN_DRAWDOWN_OBSERVATIONS ||
      portfolioReturns.some(value => !Number.isFinite(value) || value <= -1)) {
    return empty("insufficient_data", portfolioReturns.length);
  }

  let wealth = 1, peak = 1, peakIndex = 0;
  let maxDrawdown = 0, maxPeakIndex = 0, maxTroughIndex = 0;
  let maxRecoveryIndex: number | null = null;
  let currentDrawdown = 0, currentDuration: number | null = null;
  for (let i = 0; i < portfolioReturns.length; i += 1) {
    wealth *= 1 + portfolioReturns[i];
    if (!Number.isFinite(wealth) || wealth <= 0) return empty("insufficient_data", portfolioReturns.length);
    if (wealth >= peak) {
      if (maxRecoveryIndex === null && maxDrawdown > 0 && i + 1 > maxTroughIndex) {
        // Recovery is recorded only after wealth reaches the prior peak.
        if (maxPeakIndex <= maxTroughIndex) maxRecoveryIndex = i + 1;
      }
      peak = wealth;
      peakIndex = i + 1;
      currentDrawdown = 0;
      currentDuration = null;
    } else {
      const drawdown = (peak - wealth) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxPeakIndex = peakIndex;
        maxTroughIndex = i + 1;
        maxRecoveryIndex = null;
      }
      currentDrawdown = drawdown;
      currentDuration = i + 1 - peakIndex;
    }
  }
  const maxDrawdownRecovered = maxDrawdown === 0 ? true : maxRecoveryIndex !== null;
  const maxDrawdownDuration = maxDrawdown === 0 ? 0
    : (maxRecoveryIndex ?? portfolioReturns.length) - maxPeakIndex;
  return {
    status: "ready", method: "historical_static_current_exposure",
    observations: portfolioReturns.length,
    maxDrawdownPct: maxDrawdown * 100,
    currentDrawdownPct: currentDrawdown * 100,
    maxDrawdownDurationObservations: maxDrawdownDuration,
    currentDrawdownDurationObservations: currentDuration,
    maxDrawdownRecovered,
  };
}

function itemNet(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
