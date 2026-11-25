import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import type { PortfolioIntelligenceResult } from "./PortfolioIntelligenceEngine";

const MIN_DRAWDOWN_OBSERVATIONS = 30;
const MAX_CURVE_POINTS = 120;
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

export type DrawdownEpisode = {
  peakTime: number;
  troughTime: number;
  recoveryTime: number | null;
  depthPct: number;
  durationObservations: number;
  recovered: boolean;
};
export type DrawdownCurvePoint = { time: number; drawdownPct: number };
export type PortfolioDrawdownIntelligenceResult = {
  status: "ready" | "insufficient_data" | "no_exposure" | "stale_marks";
  method: "historical_static_current_exposure";
  observations: number;
  maxDrawdownPct: number | null;
  currentDrawdownPct: number | null;
  maxDrawdownDurationObservations: number | null;
  currentDrawdownDurationObservations: number | null;
  maxDrawdownRecovered: boolean | null;
  episodeCount: number;
  recoveredEpisodeCount: number;
  unrecoveredEpisodeCount: number;
  averageRecoveryObservations: number | null;
  longestEpisodeObservations: number | null;
  curve: DrawdownCurvePoint[];
  recentEpisodes: DrawdownEpisode[];
};

function empty(status: PortfolioDrawdownIntelligenceResult["status"], observations = 0): PortfolioDrawdownIntelligenceResult {
  return {
    status, method: "historical_static_current_exposure", observations,
    maxDrawdownPct: null, currentDrawdownPct: null,
    maxDrawdownDurationObservations: null, currentDrawdownDurationObservations: null,
    maxDrawdownRecovered: null, episodeCount: 0, recoveredEpisodeCount: 0,
    unrecoveredEpisodeCount: 0, averageRecoveryObservations: null,
    longestEpisodeObservations: null, curve: [], recentEpisodes: [],
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
  let path: Array<{ time: number; value: number; previousTime: number }> = [];
  let contiguous: Array<{ time: number; value: number; previousTime: number }> = [];
  for (let i = 1; i < commonCandleTimes.length; i += 1) {
    const previousTime = commonCandleTimes[i - 1], time = commonCandleTimes[i];
    if (time !== previousTime + step(interval, previousTime)) {
      if (contiguous.length > path.length) path = contiguous;
      contiguous = [];
      continue;
    }
    const value = closeMaps.reduce((sum, item) => {
      const oldClose = item.closes.get(previousTime)!;
      const newClose = item.closes.get(time)!;
      return sum + item.weight * ((newClose - oldClose) / oldClose);
    }, 0);
    if (Number.isFinite(value)) contiguous.push({ time, value, previousTime });
  }
  if (contiguous.length > path.length) path = contiguous;
  if (path.length < MIN_DRAWDOWN_OBSERVATIONS ||
      path.some(item => !Number.isFinite(item.value) || item.value <= -1)) {
    return empty("insufficient_data", path.length);
  }

  let wealth = 1, peakWealth = 1, peakTime = path[0].previousTime, peakObservation = 0;
  let active: { peakTime: number; peakObservation: number; troughTime: number; depthPct: number } | null = null;
  const episodes: DrawdownEpisode[] = [];
  const curve: DrawdownCurvePoint[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    wealth *= 1 + point.value;
    if (!Number.isFinite(wealth) || wealth <= 0) return empty("insufficient_data", path.length);
    if (wealth >= peakWealth) {
      if (active) {
        episodes.push({
          peakTime: active.peakTime, troughTime: active.troughTime, recoveryTime: point.time,
          depthPct: active.depthPct, durationObservations: i + 1 - active.peakObservation, recovered: true,
        });
        active = null;
      }
      peakWealth = wealth;
      peakTime = point.time;
      peakObservation = i + 1;
      curve.push({ time: point.time, drawdownPct: 0 });
      continue;
    }
    const drawdownPct = (peakWealth - wealth) / peakWealth * 100;
    if (!active) active = { peakTime, peakObservation, troughTime: point.time, depthPct: drawdownPct };
    if (drawdownPct > active.depthPct) {
      active.depthPct = drawdownPct;
      active.troughTime = point.time;
    }
    curve.push({ time: point.time, drawdownPct });
  }
  if (active) {
    episodes.push({
      peakTime: active.peakTime, troughTime: active.troughTime, recoveryTime: null,
      depthPct: active.depthPct, durationObservations: path.length - active.peakObservation, recovered: false,
    });
  }

  const maximum = episodes.reduce<DrawdownEpisode | null>((best, episode) =>
    !best || episode.depthPct > best.depthPct ? episode : best, null);
  const recovered = episodes.filter(episode => episode.recovered);
  const current = active ? episodes[episodes.length - 1] : null;
  const currentDrawdown = curve[curve.length - 1]?.drawdownPct ?? 0;
  const stride = Math.max(1, Math.ceil(curve.length / MAX_CURVE_POINTS));
  const sampledCurve = curve.filter((_, index) => index % stride === 0);
  if (sampledCurve[sampledCurve.length - 1]?.time !== curve[curve.length - 1].time) sampledCurve.push(curve[curve.length - 1]);

  return {
    status: "ready", method: "historical_static_current_exposure", observations: path.length,
    maxDrawdownPct: maximum?.depthPct ?? 0, currentDrawdownPct: currentDrawdown,
    maxDrawdownDurationObservations: maximum?.durationObservations ?? 0,
    currentDrawdownDurationObservations: current?.durationObservations ?? null,
    maxDrawdownRecovered: maximum?.recovered ?? true,
    episodeCount: episodes.length, recoveredEpisodeCount: recovered.length,
    unrecoveredEpisodeCount: episodes.length - recovered.length,
    averageRecoveryObservations: recovered.length
      ? recovered.reduce((sum, episode) => sum + episode.durationObservations, 0) / recovered.length : null,
    longestEpisodeObservations: episodes.length ? Math.max(...episodes.map(episode => episode.durationObservations)) : 0,
    curve: sampledCurve, recentEpisodes: episodes.slice(-8),
  };
}

function itemNet(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
