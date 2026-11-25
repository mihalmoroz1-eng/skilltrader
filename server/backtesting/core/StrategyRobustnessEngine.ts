import { createHash } from "node:crypto";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import { analyzeRegimePerformance, type RegimePerformanceAnalytics } from "./RegimePerformanceAnalytics";
import { classifyMarketRegimeWindow, MarketRegimeClassificationError, type CanonicalMarketRegime } from "../../market-regime/core/MarketRegimeClassifier";
import {
  runBacktest,
  validateBacktestCandleSeries,
  type BacktestConfig,
  type BacktestResult,
} from "./BacktestEngine";

export type StrategyRobustnessConfig = Omit<BacktestConfig, "evaluationStartIndex"> & {
  regimeLookback: number;
  trendThresholdBps: number;
  rangeThresholdBps: number;
  highVolatilityThresholdBps: number;
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

export type MarketRegimeId = CanonicalMarketRegime | "insufficient_history";

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
  sampleStatus: "insufficient_sample" | "adequate_sample";
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
  regimePerformance: RegimePerformanceAnalytics;
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
  { id: "uptrend", label: "Восходящий тренд" },
  { id: "downtrend", label: "Нисходящий тренд" },
  { id: "ranging", label: "Боковой рынок" },
  { id: "high_volatility", label: "Высокая волатильность" },
  { id: "transition", label: "Переходный режим" },
  { id: "insufficient_history", label: "Недостаточно предшествующей истории" },
];

function validateRobustnessConfig(config: StrategyRobustnessConfig): void {
  if (!Number.isInteger(config.regimeLookback) ||
      config.regimeLookback < 10 || config.regimeLookback > 200) {
    throw new StrategyRobustnessInputError("Regime lookback must be from 10 to 200 candles");
  }
  if (!Number.isInteger(config.trendThresholdBps) ||
      config.trendThresholdBps < 10 || config.trendThresholdBps > 2_000) {
    throw new StrategyRobustnessInputError("Trend threshold must be from 10 to 2,000 bps");
  }
  if (!Number.isInteger(config.rangeThresholdBps) ||
      config.rangeThresholdBps < 5 || config.rangeThresholdBps > 1_000 ||
      config.rangeThresholdBps >= config.trendThresholdBps) {
    throw new StrategyRobustnessInputError("Range threshold must be valid and below the trend threshold");
  }
  if (!Number.isInteger(config.highVolatilityThresholdBps) ||
      config.highVolatilityThresholdBps < 10 || config.highVolatilityThresholdBps > 2_000) {
    throw new StrategyRobustnessInputError("High-volatility threshold must be from 10 to 2,000 bps");
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
  if (firstIndex < 0 || lastCompletedIndex < 0) return "insufficient_history";
  if (candles[lastCompletedIndex].closeTime >= candles[entryIndex].openTime) {
    throw new StrategyRobustnessInputError("Trade regime attribution attempted to use a candle that was not closed before entry");
  }
  const window = candles.slice(firstIndex, lastCompletedIndex + 1);
  try {
    return classifyMarketRegimeWindow(window, {
      interval: config.interval,
      lookback: config.regimeLookback,
      trendThresholdBps: config.trendThresholdBps,
      rangeThresholdBps: config.rangeThresholdBps,
      highVolatilityThresholdBps: config.highVolatilityThresholdBps,
    }).regime;
  } catch (error) {
    if (error instanceof MarketRegimeClassificationError) {
      throw new StrategyRobustnessInputError(error.message);
    }
    throw error;
  }
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
      sampleStatus: trades.length < 5 ? "insufficient_sample" : "adequate_sample",
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
    regimeLookback, trendThresholdBps, rangeThresholdBps, highVolatilityThresholdBps, ...backtestConfig
  } = config;
  const baseline = runBacktest(candles, backtestConfig);
  const cost = runCostScenarios(candles, backtestConfig);
  const parameters = runParameterScenarios(candles, backtestConfig, baseline.metrics.totalReturnPct);
  const regimeConfig = { regimeLookback, trendThresholdBps, rangeThresholdBps, highVolatilityThresholdBps };
  const regimes = summarizeRegimes(candles, baseline, config);
  const regimePerformance = analyzeRegimePerformance(
    candles,
    baseline.equityCurve,
    regimes.map(item => ({ id: item.id, tradeCount: item.tradeCount })),
    {
      interval: config.interval,
      lookback: regimeLookback,
      trendThresholdBps,
      rangeThresholdBps,
      highVolatilityThresholdBps,
    },
  );
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
    regimePerformance,
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
      "Regimes use the same canonical classifier as Market Regime Intelligence: rolling net move, path efficiency and average true range.",
      "Each trade is assigned the regime from exactly lookback + 1 closed candles ending strictly before its entry candle; entry and future candles are excluded.",
      "Regime attribution is descriptive by trade entry regime; it is not a separate execution simulation for each regime.",
      "Regime performance uses close-to-close marked-equity returns classified at the current candle close; this is retrospective attribution, not a predictive signal.",
      "Regime drawdown is measured within uninterrupted episodes only; separate episodes are never concatenated.",
      "Regime volatility, Sharpe and Sortino require at least 30 interval observations; small samples remain explicitly limited or insufficient.",
      "Transition interval returns are reported separately when the canonical regime label changes.",
      "Groups with fewer than five trades are marked insufficient_sample; low-count statistics are descriptive and must not be treated as reliable evidence.",
      "All scenarios use the existing backtest fill, stop-first OHLC, fee, slippage and 1x exposure rules.",
      "Results are historical research only; executionEligible=false and no PAPER or LIVE orders are created.",
    ],
    executionEligible: false,
  };
}
