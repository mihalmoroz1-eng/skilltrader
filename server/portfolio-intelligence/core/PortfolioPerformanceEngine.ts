import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import type { PortfolioIntelligenceResult } from "./PortfolioIntelligenceEngine";

const MIN_OBSERVATIONS = 30;
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};
function intervalStep(interval: MarketInterval, time: number): number {
  if (interval === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - time;
  }
  return INTERVAL_MS[interval] ?? 0;
}
type ReturnPoint = { previousTime: number; time: number; portfolio: number; benchmark: number };
export type PerformancePeriod = {
  status: "ready" | "insufficient_history";
  observations: number;
  portfolioReturnPct: number | null;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
};
export type PortfolioPerformanceResult = {
  status: "ready" | "insufficient_data" | "no_exposure" | "stale_marks";
  method: "historical_static_current_exposure";
  observations: number;
  sampleStartTime: number | null;
  sampleEndTime: number | null;
  totalReturnPct: number | null;
  buyAndHoldReturnPct: number | null;
  excessReturnPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  riskFreeRatePct: 0;
  annualizationPeriods: number;
  maxDrawdownPct: number | null;
  returnToMaxDrawdown: number | null;
  periods: { oneDay: PerformancePeriod; sevenDay: PerformancePeriod; thirtyDay: PerformancePeriod };
  benchmarkMethod: "static_long_gross_exposure_weights";
};
function empty(status: PortfolioPerformanceResult["status"], annualizationPeriods: number): PortfolioPerformanceResult {
  const unavailable: PerformancePeriod = {
    status: "insufficient_history", observations: 0,
    portfolioReturnPct: null, benchmarkReturnPct: null, excessReturnPct: null,
  };
  return {
    status, method: "historical_static_current_exposure", observations: 0,
    sampleStartTime: null, sampleEndTime: null, totalReturnPct: null,
    buyAndHoldReturnPct: null, excessReturnPct: null, sharpeRatio: null,
    sortinoRatio: null, riskFreeRatePct: 0, annualizationPeriods,
    maxDrawdownPct: null, returnToMaxDrawdown: null,
    periods: { oneDay: unavailable, sevenDay: unavailable, thirtyDay: unavailable },
    benchmarkMethod: "static_long_gross_exposure_weights",
  };
}
function compound(values: number[]): number | null {
  let wealth = 1;
  for (const value of values) {
    if (!Number.isFinite(value) || value <= -1) return null;
    wealth *= 1 + value;
    if (!Number.isFinite(wealth)) return null;
  }
  return (wealth - 1) * 100;
}
function sampleDeviation(values: number[]): number | null {
  if (values.length < MIN_OBSERVATIONS || values.some(value => !Number.isFinite(value))) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const deviation = Math.sqrt(variance);
  return Number.isFinite(deviation) ? deviation : null;
}
function calculateMaxDrawdown(values: number[]): number | null {
  let wealth = 1, peak = 1, maximum = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value <= -1) return null;
    wealth *= 1 + value;
    if (!Number.isFinite(wealth) || wealth <= 0) return null;
    peak = Math.max(peak, wealth);
    maximum = Math.max(maximum, (peak - wealth) / peak * 100);
  }
  return maximum;
}
function periodResult(points: ReturnPoint[], durationMs: number): PerformancePeriod {
  if (points.length < MIN_OBSERVATIONS) return {
    status: "insufficient_history", observations: points.length,
    portfolioReturnPct: null, benchmarkReturnPct: null, excessReturnPct: null,
  };
  const endTime = points[points.length - 1].time;
  const targetStart = endTime - durationMs;
  const selected = points.filter(point => point.previousTime >= targetStart);
  if (!selected.length || selected[0].previousTime !== targetStart || selected[selected.length - 1].time !== endTime ||
      selected.some((point, index) => index > 0 && point.previousTime !== selected[index - 1].time)) {
    return {
      status: "insufficient_history", observations: selected.length,
      portfolioReturnPct: null, benchmarkReturnPct: null, excessReturnPct: null,
    };
  }
  const portfolioReturnPct = compound(selected.map(point => point.portfolio));
  const benchmarkReturnPct = compound(selected.map(point => point.benchmark));
  if (portfolioReturnPct === null || benchmarkReturnPct === null) return {
    status: "insufficient_history", observations: selected.length,
    portfolioReturnPct: null, benchmarkReturnPct: null, excessReturnPct: null,
  };
  return {
    status: "ready", observations: selected.length,
    portfolioReturnPct, benchmarkReturnPct,
    excessReturnPct: portfolioReturnPct - benchmarkReturnPct,
  };
}
export function calculatePortfolioPerformance(
  interval: MarketInterval,
  series: Map<string, MarketCandle[]>,
  portfolio: PortfolioIntelligenceResult["portfolio"],
): PortfolioPerformanceResult {
  const annualizationPeriods = interval === "1M"
    ? 12 : 365.2425 * 86_400_000 / (INTERVAL_MS[interval] ?? 0);
  if (!portfolio.accountAvailable || portfolio.openPositions === 0) return empty("no_exposure", annualizationPeriods);
  if (!portfolio.markToMarketAvailable || !portfolio.grossExposure) return empty("stale_marks", annualizationPeriods);
  const gross = Number(portfolio.grossExposure);
  if (!Number.isFinite(gross) || gross <= 0) return empty("no_exposure", annualizationPeriods);
  const holdings = portfolio.symbolExposure;
  if (!holdings.length || holdings.some(item => !series.has(item.symbol)) ||
      !Number.isFinite(annualizationPeriods) || annualizationPeriods <= 0) {
    return empty("insufficient_data", annualizationPeriods);
  }
  const perSymbol = holdings.map(holding => {
    const closes = new Map((series.get(holding.symbol) ?? []).map(candle => [candle.openTime, Number(candle.close)] as const));
    return {
      closes,
      netWeight: Number(holding.netNotional) / gross,
      grossWeight: Number(holding.grossNotional) / gross,
    };
  });
  const commonTimes = [...perSymbol[0].closes.keys()]
    .filter(time => perSymbol.every(item => item.closes.has(time)))
    .sort((a, b) => a - b);
  let longest: ReturnPoint[] = [];
  let current: ReturnPoint[] = [];
  for (let index = 1; index < commonTimes.length; index += 1) {
    const previousTime = commonTimes[index - 1], time = commonTimes[index];
    if (time !== previousTime + intervalStep(interval, previousTime)) {
      if (current.length > longest.length) longest = current;
      current = [];
      continue;
    }
    let portfolioReturn = 0, benchmarkReturn = 0;
    for (const item of perSymbol) {
      const previous = item.closes.get(previousTime)!, next = item.closes.get(time)!;
      const change = (next - previous) / previous;
      portfolioReturn += item.netWeight * change;
      benchmarkReturn += item.grossWeight * change;
    }
    if (Number.isFinite(portfolioReturn) && Number.isFinite(benchmarkReturn)) {
      current.push({ previousTime, time, portfolio: portfolioReturn, benchmark: benchmarkReturn });
    }
  }
  if (current.length > longest.length) longest = current;
  if (longest.length < MIN_OBSERVATIONS) return {
    ...empty("insufficient_data", annualizationPeriods), observations: longest.length,
  };

  const returns = longest.map(point => point.portfolio);
  const benchmarkReturns = longest.map(point => point.benchmark);
  const totalReturnPct = compound(returns);
  const buyAndHoldReturnPct = compound(benchmarkReturns);
  const deviation = sampleDeviation(returns);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / returns.length);
  const sharpeRatio = deviation && deviation > 0 ? mean / deviation * Math.sqrt(annualizationPeriods) : null;
  const sortinoRatio = downside > 0 ? mean / downside * Math.sqrt(annualizationPeriods) : null;
  const maxDrawdownPct = calculateMaxDrawdown(returns);
  const periods = {
    oneDay: periodResult(longest, 86_400_000),
    sevenDay: periodResult(longest, 7 * 86_400_000),
    thirtyDay: periodResult(longest, 30 * 86_400_000),
  };
  if (totalReturnPct === null || buyAndHoldReturnPct === null || maxDrawdownPct === null) {
    return { ...empty("insufficient_data", annualizationPeriods), observations: longest.length };
  }
  return {
    status: "ready", method: "historical_static_current_exposure",
    observations: longest.length, sampleStartTime: longest[0].previousTime,
    sampleEndTime: longest[longest.length - 1].time,
    totalReturnPct, buyAndHoldReturnPct, excessReturnPct: totalReturnPct - buyAndHoldReturnPct,
    sharpeRatio: sharpeRatio !== null && Number.isFinite(sharpeRatio) ? sharpeRatio : null,
    sortinoRatio: sortinoRatio !== null && Number.isFinite(sortinoRatio) ? sortinoRatio : null,
    riskFreeRatePct: 0, annualizationPeriods, maxDrawdownPct,
    returnToMaxDrawdown: maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : null,
    periods, benchmarkMethod: "static_long_gross_exposure_weights",
  };
}
