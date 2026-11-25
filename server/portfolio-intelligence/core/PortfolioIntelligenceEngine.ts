import { createHash } from "node:crypto";
import type { PortfolioIntelligenceRequest } from "@shared/portfolioIntelligence";
import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import type { HistoricalCandleRecord } from "../../historical-data/core/HistoricalDataTypes";
import type { PaperPosition } from "../../paper-execution/core/PaperExecutionEngine";
import { calculatePortfolioDrawdown, type PortfolioDrawdownIntelligenceResult } from "./PortfolioDrawdownEngine";

const SCALE = 100_000_000n;
const MAX_CANDLES = 5_000;
const MIN_OBSERVATIONS = 30;
const MAX_MARK_AGE_MS = 30_000;
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
};

export type PortfolioHistoricalSeries = { symbol: string; interval: MarketInterval; candles: HistoricalCandleRecord[] };
export type PortfolioMarkPrice = { markPrice: string; fetchedAt: number; source: string };
export type PortfolioIntelligenceInput = {
  request: PortfolioIntelligenceRequest;
  series: PortfolioHistoricalSeries[];
  portfolio: {
    account: { equity: string; maxGrossExposureBps: number } | null;
    positions: PaperPosition[];
    markPrices: Record<string, PortfolioMarkPrice> | null;
    markToMarketAvailable: boolean;
  };
  now: number;
};
export type PortfolioRiskPair = {
  symbolA: string; symbolB: string; correlation: number; observations: number;
  exposurePairWeightPct: number; level: "high" | "very_high";
};
export type PortfolioRiskIntelligenceResult = {
  assessment: "insufficient_data" | "low" | "moderate" | "high";
  eligiblePairs: number; totalHeldPairs: number; coveragePct: number | null;
  weightedAbsoluteCorrelationPct: number | null; correlatedPairs: PortfolioRiskPair[];
};

export type PortfolioRiskForecastResult = {
  status: "ready" | "insufficient_data" | "no_exposure" | "stale_marks";
  method: "historical_covariance_normal_approximation";
  annualizedPortfolioVolatilityPct: number | null;
  oneDay95VaR: string | null;
  oneDay95VaRPctOfEquity: number | null;
  fiveDay95VaR: string | null;
  fiveDay95VaRPctOfEquity: number | null;
  observations: number;
  annualizationPeriods: number;
  symbols: Array<{ symbol: string; annualizedVolatilityPct: number | null; observations: number }>;
};

export type PortfolioIntelligenceResult = {
  runId: string;
  dataDigest: string;
  symbols: string[];
  interval: MarketInterval;
  range: { startTime: number; endTime: number };
  minimumCorrelationObservations: number;
  series: Array<{ symbol: string; closedCandles: number; excludedUnclosedCandles: number; gaps: number; firstOpenTime: number | null; lastOpenTime: number | null }>;
  correlations: Array<{ symbolA: string; symbolB: string; correlation: number | null; observations: number; status: "ready" | "insufficient_history" | "constant_returns" }>;
  riskIntelligence: PortfolioRiskIntelligenceResult;
  riskForecast: PortfolioRiskForecastResult;
  drawdownIntelligence: PortfolioDrawdownIntelligenceResult;
  portfolio: {
    accountAvailable: boolean; markToMarketAvailable: boolean; openPositions: number;
    equity: string | null; grossExposure: string | null; netDirectionalExposure: string | null;
    grossExposureUtilizationBps: number | null; grossExposureLimitBps: number | null; withinConfiguredGrossExposure: boolean | null;
    symbolExposure: Array<{ symbol: string; grossNotional: string; netNotional: string; weightPct: number }>;
    concentration: { largestSymbol: string | null; largestWeightPct: number | null; herfindahlIndex: number | null };
    stressScenarios: Array<{ shockBps: number; estimatedPnl: string; stressedEquity: string; returnOnEquityPct: number; equityDepleted: boolean }> | null;
  };
  warnings: string[];
  assumptions: string[];
  executionEligible: false;
  exchangeOrderSent: false;
};

export class PortfolioIntelligenceInputError extends Error {
  constructor(message: string) { super(message); this.name = "PortfolioIntelligenceInputError"; }
}
function parseFixed(value: string, name: string): bigint {
  if (typeof value !== "string" || value.length > 40 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value)) {
    throw new PortfolioIntelligenceInputError(name + " is not a valid fixed-point decimal");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
}
function parseSignedFixed(value: string, name: string): bigint {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value)) {
    throw new PortfolioIntelligenceInputError(name + " is not a valid signed fixed-point decimal");
  }
  return value.startsWith("-") ? -parseFixed(value.slice(1), name) : parseFixed(value, name);
}
function formatFixed(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return (negative ? "-" : "") + whole.toString() + (fraction ? "." + fraction : "");
}
function mulFixed(a: bigint, b: bigint): bigint { return a * b / SCALE; }
function intervalStep(interval: MarketInterval, time: number): number {
  if (interval === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - time;
  }
  return INTERVAL_MS[interval] ?? 0;
}
function validateRequest(request: PortfolioIntelligenceRequest, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new PortfolioIntelligenceInputError("Analysis clock is invalid");
  if (request.symbols.length < 2 || request.symbols.length > 10 ||
      new Set(request.symbols).size !== request.symbols.length ||
      request.symbols.some(symbol => !/^[A-Z0-9]{2,20}$/.test(symbol))) {
    throw new PortfolioIntelligenceInputError("Use 2–10 unique uppercase symbols");
  }
  if (!Number.isSafeInteger(request.startTime) || !Number.isSafeInteger(request.endTime) ||
      request.startTime < 0 || request.endTime <= request.startTime ||
      request.endTime - request.startTime > 366 * 86_400_000) {
    throw new PortfolioIntelligenceInputError("Historical analysis range is invalid");
  }
  const step = request.interval === "1M" ? 28 * 86_400_000 : intervalStep(request.interval, request.startTime);
  if (step <= 0 || Math.ceil((request.endTime - request.startTime) / step) > MAX_CANDLES) {
    throw new PortfolioIntelligenceInputError("Narrow the date range or select a larger interval; limit is 5,000 candles per symbol");
  }
}
function validateSeries(symbol: string, interval: MarketInterval, candles: HistoricalCandleRecord[], now: number) {
  if (!Array.isArray(candles) || candles.length > MAX_CANDLES) {
    throw new PortfolioIntelligenceInputError(symbol + " exceeds the 5,000-candle limit");
  }
  let previous = -1;
  let excludedUnclosedCandles = 0;
  const closed: MarketCandle[] = [];
  for (const candle of candles) {
    const price = Number(candle.close);
    if (!Number.isSafeInteger(candle.openTime) || !Number.isSafeInteger(candle.closeTime) ||
        candle.openTime < 0 || candle.closeTime < candle.openTime || candle.openTime <= previous ||
        typeof candle.close !== "string" || candle.close.length > 80 || !Number.isFinite(price) || price <= 0) {
      throw new PortfolioIntelligenceInputError(symbol + " history contains invalid or unordered candles");
    }
    previous = candle.openTime;
    if (candle.closeTime >= now) excludedUnclosedCandles += 1;
    else closed.push(candle);
  }
  let gaps = 0;
  for (let i = 1; i < closed.length; i += 1) {
    if (closed[i].openTime > closed[i - 1].openTime + intervalStep(interval, closed[i - 1].openTime)) gaps += 1;
  }
  return {
    candles: closed,
    diagnostics: {
      symbol, closedCandles: closed.length, excludedUnclosedCandles, gaps,
      firstOpenTime: closed[0]?.openTime ?? null, lastOpenTime: closed.at(-1)?.openTime ?? null,
    },
  };
}
function pearson(left: number[], right: number[]): number | null {
  const meanA = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanB = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0, varianceA = 0, varianceB = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] - meanA, b = right[i] - meanB;
    covariance += a * b; varianceA += a * a; varianceB += b * b;
  }
  const divisor = Math.sqrt(varianceA * varianceB);
  return divisor > 0 && Number.isFinite(divisor)
    ? Math.max(-1, Math.min(1, Math.round(covariance / divisor * 1_000_000) / 1_000_000))
    : null;
}
function correlation(
  symbolA: string, symbolB: string, candlesA: MarketCandle[], candlesB: MarketCandle[], interval: MarketInterval,
): PortfolioIntelligenceResult["correlations"][number] {
  const a = new Map(candlesA.map(candle => [candle.openTime, Number(candle.close)] as const));
  const b = new Map(candlesB.map(candle => [candle.openTime, Number(candle.close)] as const));
  const times = [...a.keys()].filter(time => b.has(time)).sort((x, y) => x - y);
  const returnsA: number[] = [], returnsB: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const previous = times[i - 1], current = times[i];
    if (current !== previous + intervalStep(interval, previous)) continue;
    const oldA = a.get(previous)!, oldB = b.get(previous)!;
    returnsA.push((a.get(current)! - oldA) / oldA);
    returnsB.push((b.get(current)! - oldB) / oldB);
  }
  if (returnsA.length < MIN_OBSERVATIONS) {
    return { symbolA, symbolB, correlation: null, observations: returnsA.length, status: "insufficient_history" };
  }
  const value = pearson(returnsA, returnsB);
  return { symbolA, symbolB, correlation: value, observations: returnsA.length, status: value === null ? "constant_returns" : "ready" };
}
function emptyPortfolio(accountAvailable: boolean, openPositions: number, equity: string | null, limit: number | null) {
  return {
    accountAvailable, markToMarketAvailable: false, openPositions, equity,
    grossExposure: null, netDirectionalExposure: null, grossExposureUtilizationBps: null,
    grossExposureLimitBps: limit, withinConfiguredGrossExposure: null, symbolExposure: [],
    concentration: { largestSymbol: null, largestWeightPct: null, herfindahlIndex: null }, stressScenarios: null,
  };
}
function calculatePortfolio(input: PortfolioIntelligenceInput): PortfolioIntelligenceResult["portfolio"] {
  const { account, positions, markPrices, markToMarketAvailable } = input.portfolio;
  const open = positions.filter(position => position.status === "open");
  if (!account) return emptyPortfolio(false, 0, null, null);
  if (!markToMarketAvailable || !markPrices) return emptyPortfolio(true, open.length, account.equity, account.maxGrossExposureBps);
  const equity = parseFixed(account.equity, "PAPER equity");
  if (equity <= 0n || !Number.isInteger(account.maxGrossExposureBps) ||
      account.maxGrossExposureBps < 1 || account.maxGrossExposureBps > 10_000) {
    throw new PortfolioIntelligenceInputError("PAPER account risk limits or equity are invalid");
  }
  const bySymbol = new Map<string, { gross: bigint; net: bigint }>();
  let gross = 0n, net = 0n;
  for (const position of open) {
    const mark = markPrices[position.symbol];
    if (!mark || !mark.source?.trim() || !Number.isSafeInteger(mark.fetchedAt) ||
        mark.fetchedAt > input.now || input.now - mark.fetchedAt > MAX_MARK_AGE_MS) {
      return emptyPortfolio(true, open.length, account.equity, account.maxGrossExposureBps);
    }
    const price = parseFixed(mark.markPrice, "mark price");
    const quantity = parseFixed(position.quantity, "position quantity");
    const multiplier = parseFixed(position.contractMultiplier, "contract multiplier");
    if (price <= 0n || quantity <= 0n || multiplier <= 0n) throw new PortfolioIntelligenceInputError("PAPER position contains a non-positive value");
    const value = mulFixed(mulFixed(price, quantity), multiplier);
    const signed = position.side === "LONG" ? value : -value;
    gross += value; net += signed;
    const current = bySymbol.get(position.symbol) ?? { gross: 0n, net: 0n };
    current.gross += value; current.net += signed; bySymbol.set(position.symbol, current);
  }
  const symbolExposure = [...bySymbol.entries()].map(([symbol, value]) => ({
    symbol, grossNotional: formatFixed(value.gross), netNotional: formatFixed(value.net),
    weightPct: gross > 0n ? Number(value.gross) / Number(gross) * 100 : 0,
  })).sort((a, b) => Number(b.grossNotional) - Number(a.grossNotional));
  const largest = symbolExposure[0] ?? null;
  const herfindahlIndex = Math.round(symbolExposure.reduce((sum, value) => sum + (value.weightPct / 100) ** 2, 0) * 10_000);
  const scenarios = [-2_000, -1_000, -500].map(shockBps => {
    let pnl = 0n;
    for (const position of open) {
      const mark = markPrices[position.symbol]!;
      const value = mulFixed(mulFixed(parseFixed(mark.markPrice, "mark price"),
        parseFixed(position.quantity, "quantity")), parseFixed(position.contractMultiplier, "multiplier"));
      pnl += (position.side === "LONG" ? value : -value) * BigInt(shockBps) / 10_000n;
    }
    const stressed = equity + pnl;
    return {
      shockBps, estimatedPnl: formatFixed(pnl), stressedEquity: formatFixed(stressed),
      returnOnEquityPct: Number(pnl) / Number(equity) * 100, equityDepleted: stressed <= 0n,
    };
  });
  return {
    accountAvailable: true, markToMarketAvailable: true, openPositions: open.length,
    equity: formatFixed(equity), grossExposure: formatFixed(gross), netDirectionalExposure: formatFixed(net),
    grossExposureUtilizationBps: Number(gross * 10_000n / equity),
    grossExposureLimitBps: account.maxGrossExposureBps,
    withinConfiguredGrossExposure: gross * 10_000n <= equity * BigInt(account.maxGrossExposureBps),
    symbolExposure,
    concentration: {
      largestSymbol: largest?.symbol ?? null, largestWeightPct: largest ? largest.weightPct : null,
      herfindahlIndex,
    },
    stressScenarios: scenarios,
  };
}

function calculateRiskIntelligence(
  correlations: PortfolioIntelligenceResult["correlations"],
  portfolio: PortfolioIntelligenceResult["portfolio"],
): PortfolioRiskIntelligenceResult {
  // Without current marks, symbolExposure is intentionally empty; do not infer holdings from stale values.
  const weights = new Map(portfolio.markToMarketAvailable
    ? portfolio.symbolExposure.map(item => [item.symbol, item.weightPct / 100] as const)
    : []);
  const symbols = [...weights.keys()].sort();
  const totalHeldPairs = symbols.length >= 2 ? symbols.length * (symbols.length - 1) / 2 : 0;
  const pairMap = new Map(correlations.map(pair => [[pair.symbolA, pair.symbolB].sort().join("::"), pair] as const));
  let eligiblePairs = 0, numerator = 0, denominator = 0;
  const correlatedPairs: PortfolioRiskPair[] = [];
  for (let i = 0; i < symbols.length; i += 1) {
    for (let j = i + 1; j < symbols.length; j += 1) {
      const symbolA = symbols[i], symbolB = symbols[j];
      const pair = pairMap.get([symbolA, symbolB].join("::"));
      if (!pair || pair.status !== "ready" || pair.correlation === null ||
          !Number.isFinite(pair.correlation) || pair.correlation < -1 || pair.correlation > 1) continue;
      eligiblePairs += 1;
      const pairWeight = weights.get(symbolA)! * weights.get(symbolB)!;
      numerator += Math.abs(pair.correlation) * pairWeight;
      denominator += pairWeight;
      const absolute = Math.abs(pair.correlation);
      if (absolute >= 0.8) correlatedPairs.push({
        symbolA, symbolB, correlation: pair.correlation, observations: pair.observations,
        exposurePairWeightPct: pairWeight * 100, level: absolute >= 0.9 ? "very_high" : "high",
      });
    }
  }
  const coveragePct = totalHeldPairs > 0 ? eligiblePairs / totalHeldPairs * 100 : null;
  const weightedAbsoluteCorrelationPct = denominator > 0 ? numerator / denominator * 100 : null;
  const assessment = coveragePct === null || coveragePct < 80 || weightedAbsoluteCorrelationPct === null
    ? "insufficient_data" : weightedAbsoluteCorrelationPct >= 70 ? "high"
      : weightedAbsoluteCorrelationPct >= 40 ? "moderate" : "low";
  correlatedPairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return { assessment, eligiblePairs, totalHeldPairs, coveragePct, weightedAbsoluteCorrelationPct, correlatedPairs };
}

function sampleVolatility(values: number[]): number | null {
  if (values.length < MIN_OBSERVATIONS || values.some(value => !Number.isFinite(value))) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const volatility = Math.sqrt(variance);
  return Number.isFinite(volatility) ? volatility : null;
}
function calculateRiskForecast(
  interval: MarketInterval,
  series: Map<string, MarketCandle[]>,
  portfolio: PortfolioIntelligenceResult["portfolio"],
): PortfolioRiskForecastResult {
  const annualizationPeriods = interval === "1M"
    ? 12 : 365.2425 * 86_400_000 / (INTERVAL_MS[interval] ?? 0);
  const base = {
    method: "historical_covariance_normal_approximation" as const,
    annualizationPeriods: Number.isFinite(annualizationPeriods) ? annualizationPeriods : 0,
  };
  if (!portfolio.accountAvailable || !portfolio.openPositions) return {
    ...base, status: "no_exposure", annualizedPortfolioVolatilityPct: null,
    oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null,
    fiveDay95VaRPctOfEquity: null, observations: 0, symbols: [],
  };
  if (!portfolio.markToMarketAvailable || !portfolio.equity || !portfolio.grossExposure) return {
    ...base, status: "stale_marks", annualizedPortfolioVolatilityPct: null,
    oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null,
    fiveDay95VaRPctOfEquity: null, observations: 0, symbols: [],
  };
  const gross = parseFixed(portfolio.grossExposure, "gross exposure");
  const equity = parseFixed(portfolio.equity, "PAPER equity");
  if (gross <= 0n || equity <= 0n) return {
    ...base, status: "no_exposure", annualizedPortfolioVolatilityPct: null,
    oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null,
    fiveDay95VaRPctOfEquity: null, observations: 0, symbols: [],
  };
  const holdings = portfolio.symbolExposure;
  const perSymbol = holdings.map(holding => {
    const candles = series.get(holding.symbol) ?? [];
    const closes = new Map(candles.map(candle => [candle.openTime, Number(candle.close)] as const));
    const times = [...closes.keys()].sort((a, b) => a - b);
    const returns = new Map<number, number>();
    const samples: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
      const previous = times[i - 1], current = times[i];
      if (current !== previous + intervalStep(interval, previous)) continue;
      const oldClose = closes.get(previous)!, newClose = closes.get(current)!;
      const value = (newClose - oldClose) / oldClose;
      if (!Number.isFinite(value)) continue;
      returns.set(current, value); samples.push(value);
    }
    const volatility = sampleVolatility(samples);
    return { symbol: holding.symbol, netWeight: Number(parseSignedFixed(holding.netNotional, "net exposure") * 1_000_000_000_000n / gross) / 1_000_000_000_000, returns, volatility, observations: samples.length };
  });
  const symbols = perSymbol.map(item => ({
    symbol: item.symbol,
    annualizedVolatilityPct: item.volatility === null ? null : item.volatility * Math.sqrt(annualizationPeriods) * 100,
    observations: item.observations,
  }));
  if (!perSymbol.length || perSymbol.some(item => item.volatility === null || !series.has(item.symbol)) ||
      !Number.isFinite(annualizationPeriods) || annualizationPeriods <= 0) return {
    ...base, status: "insufficient_data", annualizedPortfolioVolatilityPct: null,
    oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null,
    fiveDay95VaRPctOfEquity: null, observations: perSymbol.length ? Math.min(...perSymbol.map(item => item.observations)) : 0, symbols,
  };
  const commonTimes = [...perSymbol[0].returns.keys()].filter(time => perSymbol.every(item => item.returns.has(time))).sort((a, b) => a - b);
  const portfolioReturns: number[] = commonTimes.map(time => perSymbol.reduce((sum, item) => sum + item.netWeight * item.returns.get(time)!, 0));
  const dailyVolatility = sampleVolatility(portfolioReturns);
  if (dailyVolatility === null) return {
    ...base, status: "insufficient_data", annualizedPortfolioVolatilityPct: null,
    oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null,
    fiveDay95VaRPctOfEquity: null, observations: portfolioReturns.length, symbols,
  };
  const annualized = dailyVolatility * Math.sqrt(annualizationPeriods);
  const oneDayVaR = gross * BigInt(Math.round(dailyVolatility * 1.645 * 100_000_000)) / 100_000_000n;
  const fiveDayVaR = gross * BigInt(Math.round(dailyVolatility * 1.645 * Math.sqrt(5) * 100_000_000)) / 100_000_000n;
  const oneDayPct = Number(oneDayVaR * 1_000_000n / equity) / 10_000;
  const fiveDayPct = Number(fiveDayVaR * 1_000_000n / equity) / 10_000;
  if (![annualized, oneDayPct, fiveDayPct].every(Number.isFinite)) return {
    ...base, status: "insufficient_data", annualizedPortfolioVolatilityPct: null,
    oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null,
    fiveDay95VaRPctOfEquity: null, observations: portfolioReturns.length, symbols,
  };
  return {
    ...base, status: "ready", annualizedPortfolioVolatilityPct: annualized * 100,
    oneDay95VaR: formatFixed(oneDayVaR), oneDay95VaRPctOfEquity: oneDayPct,
    fiveDay95VaR: formatFixed(fiveDayVaR), fiveDay95VaRPctOfEquity: fiveDayPct,
    observations: portfolioReturns.length, symbols,
  };
}

export function runPortfolioIntelligence(input: PortfolioIntelligenceInput): PortfolioIntelligenceResult {
  validateRequest(input.request, input.now);
  const symbols = [...input.request.symbols].sort();
  if (input.series.length !== symbols.length) throw new PortfolioIntelligenceInputError("Historical series count does not match symbols");
  const map = new Map<string, MarketCandle[]>();
  const diagnostics: PortfolioIntelligenceResult["series"] = [];
  const digestPayload: unknown[] = [];
  for (const symbol of symbols) {
    const source = input.series.find(item => item.symbol === symbol);
    if (!source || source.interval !== input.request.interval) throw new PortfolioIntelligenceInputError("Missing or incompatible historical series for " + symbol);
    const result = validateSeries(symbol, source.interval, source.candles, input.now);
    map.set(symbol, result.candles);
    diagnostics.push(result.diagnostics);
    digestPayload.push({
      symbol, interval: source.interval,
      candles: source.candles.map(c => ({ openTime: c.openTime, closeTime: c.closeTime, close: c.close, source: c.source, fetchedAt: c.fetchedAt })),
    });
  }
  const pairs: PortfolioIntelligenceResult["correlations"] = [];
  for (let i = 0; i < symbols.length; i += 1) {
    for (let j = i + 1; j < symbols.length; j += 1) {
      pairs.push(correlation(symbols[i], symbols[j], map.get(symbols[i])!, map.get(symbols[j])!, input.request.interval));
    }
  }
  const dataDigest = createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex");
  const portfolio = calculatePortfolio(input);
  const riskIntelligence = calculateRiskIntelligence(pairs, portfolio);
  const riskForecast = calculateRiskForecast(input.request.interval, map, portfolio);
  const drawdownIntelligence = calculatePortfolioDrawdown(input.request.interval, map, portfolio);
  const warnings: string[] = [];
  if (diagnostics.some(item => item.gaps > 0)) warnings.push("Исторические пропуски обнаружены; свечи не синтезировались, корреляция учитывает только соседние совпадающие интервалы.");
  if (diagnostics.some(item => item.excludedUnclosedCandles > 0)) warnings.push("Незакрытые свечи исключены.");
  if (pairs.some(item => item.status === "insufficient_history")) warnings.push("Для некоторых пар меньше 30 совпадающих последовательных доходностей; корреляция скрыта.");
  if (pairs.some(item => item.status === "constant_returns")) warnings.push("Для пары с нулевой вариацией доходности коэффициент корреляции не определён.");
  if (!portfolio.accountAvailable) warnings.push("PAPER-счёт не создан: доступна только историческая корреляция.");
  else if (!portfolio.markToMarketAvailable) warnings.push("Нет актуальных mark-price данных (максимальный возраст 30 секунд); экспозиция и стресс-оценка скрыты.");
  if (portfolio.withinConfiguredGrossExposure === false) warnings.push("Отмеченная gross-экспозиция превышает лимит PAPER-счёта; это предупреждение аналитики, а не решение о допуске.");
  const assumptions = [
    "Используется Pearson correlation простых close-to-close доходностей, а не уровней цен.",
    "Для пары учитываются только точные общие open-time и соседние интервалы; пропуски не интерполируются.",
    "Корреляция показывается только при наличии не менее 30 последовательных совпадающих доходностей.",
    "Используются только сохранённые закрытые свечи; данные для символов должны быть предварительно загружены.",
    "Экспозиция рассчитывается по public mark price × quantity × contract multiplier с fixed-point арифметикой.",
    "Стресс-шоки -5%, -10% и -20% применяются параллельно ко всем открытым линейным позициям; LONG и SHORT имеют разные знаки PnL.",
    "Не моделируются ликвидация, маржин-колл, funding, заём, плечо, рыночное воздействие, проскальзывание выхода, новые комиссии и изменение корреляций.",
    "Историческая оценка волатильности и 95% VaR использует sample covariance по точным общим последовательным доходностям, нормальное приближение и sqrt(time); это сценарная статистика, не прогноз гарантированного убытка.",
    "Для портфельной доходности используются signed net exposures, нормированные на текущую gross exposure; VaR денежно масштабируется на gross exposure и сравнивается с текущей PAPER equity.",
    "Историческая просадка реконструируется с постоянными текущими signed net exposure weights; это приближение, не фактическая историческая NAV или история изменения состава портфеля.",
    "Просадка считается только по общим последовательным интервалам; минимум 30 наблюдений, пропуски не заполняются, восстановление фиксируется только после возврата к предыдущему пику.",
    "Модуль только читает данные. Account Risk Engine остаётся источником допуска к PAPER и расчёта размера позиции.",
  ];
  const runId = createHash("sha256").update(JSON.stringify({
    request: input.request, now: input.now, dataDigest, portfolio,
    positions: input.portfolio.positions.map(p => ({
      id: p.id, symbol: p.symbol, side: p.side, quantity: p.quantity,
      contractMultiplier: p.contractMultiplier, status: p.status,
    })).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
    marks: Object.entries(input.portfolio.markPrices ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  })).digest("hex").slice(0, 24);
  return {
    runId, dataDigest, symbols, interval: input.request.interval,
    range: { startTime: input.request.startTime, endTime: input.request.endTime },
    minimumCorrelationObservations: MIN_OBSERVATIONS,
    series: diagnostics, correlations: pairs, riskIntelligence, riskForecast, drawdownIntelligence, portfolio, warnings, assumptions,
    executionEligible: false, exchangeOrderSent: false,
  };
}
