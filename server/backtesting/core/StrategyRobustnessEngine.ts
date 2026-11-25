import { createHash } from "node:crypto";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import {
  runBacktest,
  validateBacktestCandleSeries,
  type BacktestConfig,
  type BacktestResult,
} from "./BacktestEngine";

export type StrategyRobustnessConfig = Omit<BacktestConfig, "evaluationStartIndex"> & {
  regimeLookback: number;
  trendThresholdBps: number;
  volatilityThresholdBps: number;
};

export type RobustnessCostScenario = {
  id: "baseline" | "cost_1_5x" | "cost_2x";
  multiplier: number;
  feeBps: number;
  slippageBps: number;
  returnPct: number;
  maxDrawdownPct: number;
  totalTrades: number;
  profitFactor: number | null;
  runId: string;
};

export type RobustnessParameterScenario = {
  id: string;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  returnPct: number;
  returnDeltaFromBaselinePct: number;
  maxDrawdownPct: number;
  totalTrades: number;
  winRatePct: number;
  runId: string;
};

export type MarketRegimeId =
  | "bullish_low_volatility"
  | "bullish_high_volatility"
  | "bearish_low_volatility"
  | "bearish_high_volatility"
  | "range_low_volatility"
  | "range_high_volatility"
  | "insufficient_history";

export type RobustnessRegimeResult = {
  id: MarketRegimeId;
  label: string;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  netPnl: number;
  averageTradePnl: number;
  winRatePct: number;
  profitFactor: number | null;
};

export type StrategyRobustnessResult = {
  runId: string;
  dataDigest: string;
  symbol: string;
  interval: BacktestConfig["interval"];
  strategy: "ema_crossover";
  candlesProcessed: number;
  baseline: {
    runId: string;
    returnPct: number;
    netProfit: number;
    maxDrawdownPct: number;
    totalTrades: number;
    winRatePct: number;
    profitFactor: number | null;
    feesPaid: number;
  };
  costScenarios: RobustnessCostScenario[];
  parameterScenarios: RobustnessParameterScenario[];
  regimes: RobustnessRegimeResult[];
  metrics: {
    worstCostStressReturnPct: number;
    costStressReturnChangePct: number;
    parameterReturnSpreadPct: number;
    minimumParameterReturnPct: number;
    maximumParameterReturnPct: number;
    profitableParameterVariantsPct: number;
    worstParameterDrawdownPct: number;
    mostActiveRegime: MarketRegimeId | null;
    regimeCoveragePct: number;
  };
  assumptions: string[];
  executionEligible: false;
};

export class StrategyRobustnessInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyRobustnessInputError";
  }
}

const REGIME_DEFINITIONS: Array<{ id: MarketRegimeId; label: string }> = [
  { id: "bullish_low_volatility", label: "Восходящий тренд · низкая волатильность" },
  { id: "bullish_high_volatility", label: "Восходящий тренд · высокая волатильность" },
  { id: "bearish_low_volatility", label: "Нисходящий тренд · низкая волатильность" },
  { id: "bearish_high_volatility", label: "Нисходящий тренд · высокая волатильность" },
  { id: "range_low_volatility", label: "Боковой рынок · низкая волатильность" },
  { id: "range_high_volatility", label: "Боковой рынок · высокая волатильность" },
  { id: "insufficient_history", label: "Недостаточно предшествующей истории" },
];

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function validateRobustnessConfig(config: StrategyRobustnessConfig): void {
  if (!Number.isInteger(config.regimeLookback) ||
      config.regimeLookback < 5 || config.regimeLookback > 200) {
    throw new StrategyRobustnessInputError("Regime lookback must be from 5 to 200 candles");
  }
  if (!Number.isInteger(config.trendThresholdBps) ||
      config.trendThresholdBps < 10 || config.trendThresholdBps > 5_000) {
    throw new StrategyRobustnessInputError("Trend threshold must be from 10 to 5,000 bps");
  }
  if (!Number.isInteger(config.volatilityThresholdBps) ||
      config.volatilityThresholdBps < 1 || config.volatilityThresholdBps > 2_000) {
    throw new StrategyRobustnessInputError("Volatility threshold must be from 1 to 2,000 bps");
  }
  if (config.feeBps > 50 || config.slippageBps > 50) {
    throw new StrategyRobustnessInputError("Base fees and slippage must each be at most 50 bps for 2x stress testing");
  }
}

function runCostScenarios(candles: MarketCandle[], config: BacktestConfig): {
  scenarios: RobustnessCostScenario[];
  results: BacktestResult[];
} {
  const multipliers = [
    { id: "baseline" as const, multiplier: 1 },
    { id: "cost_1_5x" as const, multiplier: 1.5 },
    { id: "cost_2x" as const, multiplier: 2 },
  ];
  const results = multipliers.map(({ multiplier }) => runBacktest(candles, {
    ...config,
    feeBps: Math.ceil(config.feeBps * multiplier),
    slippageBps: Math.ceil(config.slippageBps * multiplier),
  }));
  return {
    results,
    scenarios: multipliers.map(({ id, multiplier }, index) => {
      const result = results[index];
      return {
        id,
        multiplier,
        feeBps: Math.ceil(config.feeBps * multiplier),
        slippageBps: Math.ceil(config.slippageBps * multiplier),
        returnPct: result.metrics.totalReturnPct,
        maxDrawdownPct: result.metrics.maxDrawdownPct,
        totalTrades: result.metrics.totalTrades,
        profitFactor: result.metrics.profitFactor,
        runId: result.runId,
      };
    }),
  };
}

function buildParameterConfigs(config: BacktestConfig): Array<{
  id: string;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
}> {
  const candidates = [
    { fast: config.fastEmaPeriod - 2, slow: config.slowEmaPeriod },
    { fast: config.fastEmaPeriod - 1, slow: config.slowEmaPeriod },
    { fast: config.fastEmaPeriod + 1, slow: config.slowEmaPeriod },
    { fast: config.fastEmaPeriod + 2, slow: config.slowEmaPeriod },
    { fast: config.fastEmaPeriod, slow: config.slowEmaPeriod - 5 },
    { fast: config.fastEmaPeriod, slow: config.slowEmaPeriod + 5 },
    { fast: config.fastEmaPeriod - 1, slow: config.slowEmaPeriod - 5 },
    { fast: config.fastEmaPeriod + 1, slow: config.slowEmaPeriod + 5 },
  ];
  const seen = new Set<string>();
  return candidates
    .filter(({ fast, slow }) =>
      Number.isInteger(fast) && Number.isInteger(slow) &&
      fast >= 2 && fast <= 100 && slow > fast && slow <= 300)
    .filter(({ fast, slow }) => {
      const key = `${fast}:${slow}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ fast, slow }) => ({
      id: `ema_${fast}_${slow}`,
      fastEmaPeriod: fast,
      slowEmaPeriod: slow,
    }));
}

function runParameterScenarios(
  candles: MarketCandle[],
  config: BacktestConfig,
  baselineReturnPct: number,
): RobustnessParameterScenario[] {
  const variants = buildParameterConfigs(config);
  if (variants.length < 2) {
    throw new StrategyRobustnessInputError("Base EMA periods are too close to supported limits for neighbor sensitivity checks");
  }
  return variants.map(variant => {
    const result = runBacktest(candles, {
      ...config,
      fastEmaPeriod: variant.fastEmaPeriod,
      slowEmaPeriod: variant.slowEmaPeriod,
    });
    return {
      ...variant,
      returnPct: result.metrics.totalReturnPct,
      returnDeltaFromBaselinePct: result.metrics.totalReturnPct - baselineReturnPct,
      maxDrawdownPct: result.metrics.maxDrawdownPct,
      totalTrades: result.metrics.totalTrades,
      winRatePct: result.metrics.winRatePct,
      runId: result.runId,
    };
  });
}

function classifyTradeRegime(
  candles: MarketCandle[],
  entryIndex: number,
  config: StrategyRobustnessConfig,
): MarketRegimeId {
  const lastCompletedIndex = entryIndex - 1;
  const firstIndex = lastCompletedIndex - config.regimeLookback;
  if (firstIndex < 0 || lastCompletedIndex >= candles.length) return "insufficient_history";

  const firstClose = Number(candles[firstIndex].close);
  const lastClose = Number(candles[lastCompletedIndex].close);
  if (!Number.isFinite(firstClose) || firstClose <= 0 || !Number.isFinite(lastClose) || lastClose <= 0) {
    return "insufficient_history";
  }

  const momentumBps = (lastClose / firstClose - 1) * 10_000;
  const returnsBps: number[] = [];
  for (let index = firstIndex + 1; index <= lastCompletedIndex; index += 1) {
    const previous = Number(candles[index - 1].close);
    const current = Number(candles[index].close);
    if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current) || current <= 0) {
      return "insufficient_history";
    }
    returnsBps.push((current / previous - 1) * 10_000);
  }
  const volatilityBps = standardDeviation(returnsBps);
  const trend = momentumBps >= config.trendThresholdBps
    ? "bullish"
    : momentumBps <= -config.trendThresholdBps ? "bearish" : "range";
  const volatility = volatilityBps >= config.volatilityThresholdBps ? "high_volatility" : "low_volatility";
  return `${trend}_${volatility}` as MarketRegimeId;
}

function summarizeRegimes(
  candles: MarketCandle[],
  baseline: BacktestResult,
  config: StrategyRobustnessConfig,
): RobustnessRegimeResult[] {
  const indexByOpenTime = new Map(candles.map((candle, index) => [candle.openTime, index]));
  const groups = new Map<MarketRegimeId, typeof baseline.trades>();
  for (const definition of REGIME_DEFINITIONS) groups.set(definition.id, []);

  for (const trade of baseline.trades) {
    const index = indexByOpenTime.get(trade.entryTime);
    const regime = index === undefined
      ? "insufficient_history"
      : classifyTradeRegime(candles, index, config);
    groups.get(regime)!.push(trade);
  }

  return REGIME_DEFINITIONS.map(definition => {
    const trades = groups.get(definition.id)!;
    const winners = trades.filter(trade => trade.netPnl > 0);
    const losers = trades.filter(trade => trade.netPnl < 0);
    const positivePnl = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
    const negativePnl = Math.abs(losers.reduce((sum, trade) => sum + trade.netPnl, 0));
    return {
      id: definition.id,
      label: definition.label,
      tradeCount: trades.length,
      winningTrades: winners.length,
      losingTrades: losers.length,
      netPnl: trades.reduce((sum, trade) => sum + trade.netPnl, 0),
      averageTradePnl: trades.length
        ? trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length : 0,
      winRatePct: trades.length ? winners.length / trades.length * 100 : 0,
      profitFactor: negativePnl === 0 ? (positivePnl > 0 ? null : 0) : positivePnl / negativePnl,
    };
  });
}

export function runStrategyRobustness(
  candles: MarketCandle[],
  config: StrategyRobustnessConfig,
): StrategyRobustnessResult {
  validateRobustnessConfig(config);
  if (candles.length > 50_000) {
    throw new StrategyRobustnessInputError("Strategy robustness is limited to 50,000 historical candles");
  }
  if (candles.length <= config.slowEmaPeriod + 1) {
    throw new StrategyRobustnessInputError("Insufficient history for the base EMA strategy");
  }
  validateBacktestCandleSeries(candles, config.interval);

  const {
    regimeLookback, trendThresholdBps, volatilityThresholdBps, ...backtestConfig
  } = config;
  const baseline = runBacktest(candles, backtestConfig);
  const cost = runCostScenarios(candles, backtestConfig);
  const parameters = runParameterScenarios(candles, backtestConfig, baseline.metrics.totalReturnPct);
  const regimeConfig = { regimeLookback, trendThresholdBps, volatilityThresholdBps };
  const regimes = summarizeRegimes(candles, baseline, config);
  const parameterReturns = parameters.map(item => item.returnPct);
  const costReturns = cost.scenarios.map(item => item.returnPct);
  const worstCostStressReturnPct = Math.min(...costReturns);
  const minimumParameterReturnPct = Math.min(...parameterReturns);
  const maximumParameterReturnPct = Math.max(...parameterReturns);
  const profitableParameterVariants = parameters.filter(item => item.returnPct > 0).length;
  const regimeTrades = regimes.filter(item => item.id !== "insufficient_history");
  const classifiedTradeCount = regimeTrades.reduce((sum, item) => sum + item.tradeCount, 0);
  const mostActiveRegime = regimeTrades.reduce<MarketRegimeId | null>(
    (current, item) => item.tradeCount > (regimeTrades.find(regime => regime.id === current)?.tradeCount ?? 0)
      ? item.id : current,
    null,
  );
  const dataDigest = baseline.dataDigest;
  const runId = createHash("sha256").update(JSON.stringify({
    config,
    dataDigest,
    baselineRunId: baseline.runId,
    costRunIds: cost.scenarios.map(item => item.runId),
    parameterRunIds: parameters.map(item => item.runId),
    regimeConfig,
  })).digest("hex").slice(0, 24);

  return {
    runId,
    dataDigest,
    symbol: config.symbol,
    interval: config.interval,
    strategy: "ema_crossover",
    candlesProcessed: candles.length,
    baseline: {
      runId: baseline.runId,
      returnPct: baseline.metrics.totalReturnPct,
      netProfit: baseline.metrics.netProfit,
      maxDrawdownPct: baseline.metrics.maxDrawdownPct,
      totalTrades: baseline.metrics.totalTrades,
      winRatePct: baseline.metrics.winRatePct,
      profitFactor: baseline.metrics.profitFactor,
      feesPaid: baseline.metrics.feesPaid,
    },
    costScenarios: cost.scenarios,
    parameterScenarios: parameters,
    regimes,
    metrics: {
      worstCostStressReturnPct,
      costStressReturnChangePct: worstCostStressReturnPct - baseline.metrics.totalReturnPct,
      parameterReturnSpreadPct: maximumParameterReturnPct - minimumParameterReturnPct,
      minimumParameterReturnPct,
      maximumParameterReturnPct,
      profitableParameterVariantsPct: parameters.length
        ? profitableParameterVariants / parameters.length * 100 : 0,
      worstParameterDrawdownPct: Math.max(...parameters.map(item => item.maxDrawdownPct)),
      mostActiveRegime,
      regimeCoveragePct: baseline.metrics.totalTrades > 0
        ? classifiedTradeCount / baseline.metrics.totalTrades * 100 : 0,
    },
    assumptions: [
      "Cost stress runs reuse the same candles and strategy while testing baseline, 1.5x and 2x fees and adverse slippage.",
      "EMA sensitivity checks only a small, fixed set of neighboring fast/slow periods; no optimization or best-parameter selection is performed.",
      "Market regimes are assigned to each baseline trade using only completed candles before its entry candle.",
      "Trend regime uses trailing close-to-close momentum; volatility regime uses the standard deviation of trailing close-to-close returns.",
      "Regime thresholds are user-configured basis-point values per candle and are not automatically calibrated from the full sample.",
      "Regime attribution is descriptive by trade entry regime; it is not a separate execution simulation for each regime.",
      "All scenarios use the existing backtest fill, stop-first OHLC, fee, slippage and 1x exposure rules.",
      "Results are historical research only; executionEligible=false and no PAPER or LIVE orders are created.",
    ],
    executionEligible: false,
  };
}
