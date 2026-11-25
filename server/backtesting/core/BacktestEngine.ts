import { createHash } from "node:crypto";
import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import { validateCandles } from "../../market-data/core/MarketDataValidator";
import { emaCrossoverStrategy, type EmaCrossoverConfig } from "../strategies/EmaCrossoverStrategy";
import type { BacktestStrategy } from "../strategies/Strategy";

export type BacktestConfig = {
  symbol: string;
  interval: MarketInterval;
  startingCapital: number;
  riskBps: number;
  stopLossBps: number;
  takeProfitBps: number;
  feeBps: number;
  slippageBps: number;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  allowShort: boolean;
  /** Internal evaluation boundary; preceding candles are indicator warm-up only. */
  evaluationStartIndex?: number;
};

export type BacktestTrade = {
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  netReturnPct: number;
  exitReason: "stop_loss" | "take_profit" | "opposite_signal" | "strategy_exit" | "end_of_data";
};

export type BacktestExecutionConfig = Omit<BacktestConfig, "fastEmaPeriod" | "slowEmaPeriod">;

export type BacktestResult = {
  runId: string;
  dataDigest: string;
  symbol: string;
  interval: MarketInterval;
  strategy: string;
  candlesProcessed: number;
  trades: BacktestTrade[];
  equityCurve: Array<{ time: number; equity: number }>;
  metrics: {
    startingCapital: number;
    finalEquity: number;
    netProfit: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number | null;
    averageTradePct: number;
    feesPaid: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
  };
  assumptions: string[];
  executionEligible: false;
};

export class BacktestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestInputError";
  }
}

type Position = {
  side: "LONG" | "SHORT";
  entryTime: number;
  entryPrice: number;
  quantity: number;
  stopPrice: number;
  targetPrice: number;
  entryFee: number;
};

const FIXED_INTERVAL_MS: Partial<Record<MarketInterval, number>> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
  "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};

function nextOpenTime(openTime: number, interval: MarketInterval): number {
  if (interval === "1M") {
    const date = new Date(openTime);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  const step = FIXED_INTERVAL_MS[interval];
  if (!step) throw new BacktestInputError("Unsupported interval");
  return openTime + step;
}

export function validateBacktestCandleSeries(candles: MarketCandle[], interval: MarketInterval): void {
  if (candles.length > 50_000) throw new BacktestInputError("Backtest is limited to 50,000 candles");
  validateCandles(candles);
  for (let i = 0; i < candles.length; i += 1) {
    const expectedClose = nextOpenTime(candles[i].openTime, interval) - 1;
    if (candles[i].closeTime !== expectedClose) {
      throw new BacktestInputError(`Candle ${i} does not match the requested interval`);
    }
    if (i > 0 && candles[i].openTime !== nextOpenTime(candles[i - 1].openTime, interval)) {
      throw new BacktestInputError("Historical series contains a gap; backtest requires contiguous candles");
    }
  }
}

function finitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new BacktestInputError(`${name} must be finite and positive`);
}

function adverseEntryPrice(open: number, side: "LONG" | "SHORT", slippageRate: number): number {
  return side === "LONG" ? open * (1 + slippageRate) : open * (1 - slippageRate);
}

function adverseExitPrice(price: number, side: "LONG" | "SHORT", slippageRate: number): number {
  return side === "LONG" ? price * (1 - slippageRate) : price * (1 + slippageRate);
}

export function runBacktest(candles: MarketCandle[], config: BacktestConfig): BacktestResult {
  const strategyConfig: EmaCrossoverConfig = { fastEmaPeriod: config.fastEmaPeriod, slowEmaPeriod: config.slowEmaPeriod };
  const { fastEmaPeriod: _fast, slowEmaPeriod: _slow, ...executionConfig } = config;
  return runBacktestWithStrategy(candles, executionConfig, emaCrossoverStrategy, strategyConfig);
}

export function runBacktestWithStrategy<TConfig>(
  candles: MarketCandle[],
  config: BacktestExecutionConfig,
  strategy: BacktestStrategy<TConfig>,
  strategyConfig: TConfig,
): BacktestResult {
  finitePositive(config.startingCapital, "startingCapital");
  if (!/^[A-Z0-9]{2,20}$/.test(config.symbol) ||
      !Number.isInteger(config.riskBps) || config.riskBps < 1 || config.riskBps > 1_000 || config.riskBps >= config.stopLossBps ||
      !Number.isInteger(config.stopLossBps) || config.stopLossBps < 10 || config.stopLossBps > 5_000 ||
      !Number.isInteger(config.takeProfitBps) || config.takeProfitBps < 10 || config.takeProfitBps > 10_000 ||
      !Number.isInteger(config.feeBps) || config.feeBps < 0 || config.feeBps > 100 ||
      !Number.isInteger(config.slippageBps) || config.slippageBps < 0 || config.slippageBps > 100) {
    throw new BacktestInputError("Risk, stop, target, fee or slippage parameters are invalid");
  }
  let minimumHistory: number;
  try { minimumHistory = strategy.minimumHistory(strategyConfig); }
  catch (error) { throw new BacktestInputError(error instanceof Error ? error.message : "Strategy configuration is invalid"); }
  if (!Number.isSafeInteger(minimumHistory) || minimumHistory < 2) throw new BacktestInputError("Strategy returned an invalid minimum history requirement");
  if (candles.length < minimumHistory) throw new BacktestInputError("Insufficient candles for strategy warm-up");
  const evaluationStartIndex = config.evaluationStartIndex ?? 0;
  if (!Number.isInteger(evaluationStartIndex) || evaluationStartIndex < 0 ||
      evaluationStartIndex >= candles.length ||
      (evaluationStartIndex > 0 && evaluationStartIndex < minimumHistory - 1)) {
    throw new BacktestInputError("Evaluation boundary must follow the EMA warm-up period and precede the final candle");
  }
  validateBacktestCandleSeries(candles, config.interval);

  const closes = candles.map(candle => Number(candle.close));
  if (closes.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new BacktestInputError("Candle prices cannot be represented safely");
  }
  let signalProvider;
  try { signalProvider = strategy.createSignalProvider(candles, strategyConfig); }
  catch (error) { throw new BacktestInputError(error instanceof Error ? error.message : "Strategy signal provider could not be created"); }
  const feeRate = config.feeBps / 10_000;
  const slippageRate = config.slippageBps / 10_000;
  const stopRate = config.stopLossBps / 10_000;
  const targetRate = config.takeProfitBps / 10_000;
  const riskRate = config.riskBps / 10_000;

  let equity = config.startingCapital;
  let peakEquity = equity;
  let maxDrawdownPct = 0;
  let feesPaid = 0;
  let position: Position | null = null;
  const trades: BacktestTrade[] = [];
  const evaluationIndex = Math.max(minimumHistory - 1, evaluationStartIndex);
  const equityCurve: Array<{ time: number; equity: number }> = [
    { time: candles[evaluationIndex].openTime, equity },
  ];

  const closePosition = (
    candle: MarketCandle,
    rawExit: number,
    exitTime: number,
    exitReason: BacktestTrade["exitReason"],
  ) => {
    if (!position) return;
    const current = position;
    const exitPrice = adverseExitPrice(rawExit, current.side, slippageRate);
    const sign = current.side === "LONG" ? 1 : -1;
    const grossPnl = (exitPrice - current.entryPrice) * current.quantity * sign;
    const exitFee = exitPrice * current.quantity * feeRate;
    const totalFees = current.entryFee + exitFee;
    const netPnl = grossPnl - totalFees;
    equity += grossPnl - exitFee;
    feesPaid += exitFee;
    trades.push({
      side: current.side, entryTime: current.entryTime, exitTime,
      entryPrice: current.entryPrice, exitPrice, quantity: current.quantity,
      grossPnl, fees: totalFees, netPnl,
      netReturnPct: current.entryPrice * current.quantity > 0
        ? netPnl / (current.entryPrice * current.quantity) * 100 : 0,
      exitReason,
    });
    position = null;
  };

  for (let i = Math.max(minimumHistory - 1, evaluationStartIndex); i < candles.length; i += 1) {
    const candle = candles[i];
    const signal = signalProvider.signalAt(i - 1);
    const crossUp = signal === "LONG";
    const crossDown = signal === "SHORT";
    const exitLong = signal === "EXIT_LONG";
    const exitShort = signal === "EXIT_SHORT";
    const strategyExit = position?.side === "LONG" ? exitLong : position?.side === "SHORT" ? exitShort : false;

    const hadPositionAtStart = position !== null;
    if (position && (strategyExit ||
        (position.side === "LONG" && crossDown) || (position.side === "SHORT" && crossUp))) {
      closePosition(
        candle,
        Number(candle.open),
        candle.openTime,
        strategyExit ? "strategy_exit" : "opposite_signal",
      );
    }

    if (!hadPositionAtStart && !position && !exitLong && !exitShort && (crossUp || (config.allowShort && crossDown))) {
      const side = crossUp ? "LONG" : "SHORT";
      const entryPrice = adverseEntryPrice(Number(candle.open), side, slippageRate);
      const riskBudget = equity * riskRate;
      const notional = Math.min(equity, riskBudget / stopRate);
      const quantity = notional / entryPrice;
      const entryFee = notional * feeRate;
      if (quantity > 0 && Number.isFinite(quantity) && entryPrice > 0 && equity > entryFee) {
        equity -= entryFee;
        feesPaid += entryFee;
        position = {
          side, entryTime: candle.openTime, entryPrice, quantity,
          stopPrice: side === "LONG" ? entryPrice * (1 - stopRate) : entryPrice * (1 + stopRate),
          targetPrice: side === "LONG" ? entryPrice * (1 + targetRate) : entryPrice * (1 - targetRate),
          entryFee,
        };
      }
    }

    if (position) {
      const p = position;
      const stopHit = p.side === "LONG" ? Number(candle.low) <= p.stopPrice : Number(candle.high) >= p.stopPrice;
      const targetHit = p.side === "LONG" ? Number(candle.high) >= p.targetPrice : Number(candle.low) <= p.targetPrice;
      if (stopHit) {
        const gapAtOpen = p.side === "LONG" ? Number(candle.open) < p.stopPrice : Number(candle.open) > p.stopPrice;
        closePosition(candle, gapAtOpen ? Number(candle.open) : p.stopPrice, candle.closeTime, "stop_loss");
      } else if (targetHit) {
        const gapAtOpen = p.side === "LONG" ? Number(candle.open) > p.targetPrice : Number(candle.open) < p.targetPrice;
        closePosition(candle, gapAtOpen ? Number(candle.open) : p.targetPrice, candle.closeTime, "take_profit");
      }
    }

    const markToMarket = position
      ? equity + (Number(candle.close) - position.entryPrice) * position.quantity * (position.side === "LONG" ? 1 : -1)
      : equity;
    peakEquity = Math.max(peakEquity, markToMarket);
    if (peakEquity > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - markToMarket) / peakEquity * 100);
    equityCurve.push({ time: candle.closeTime, equity: markToMarket });
  }

  if (position) closePosition(candles[candles.length - 1], Number(candles[candles.length - 1].close), candles[candles.length - 1].closeTime, "end_of_data");
  peakEquity = Math.max(peakEquity, equity);
  if (peakEquity > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - equity) / peakEquity * 100);

  const finalEquity = equity;
  if (equityCurve.length) equityCurve[equityCurve.length - 1] = { time: candles[candles.length - 1].closeTime, equity: finalEquity };
  const netProfit = finalEquity - config.startingCapital;
  const wins = trades.filter(trade => trade.netPnl > 0);
  const losses = trades.filter(trade => trade.netPnl < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const profitFactor = grossLosses === 0 ? (grossWins > 0 ? null : 0) : grossWins / grossLosses;
  const dataDigest = createHash("sha256").update(JSON.stringify(candles)).digest("hex");
  const runId = createHash("sha256").update(JSON.stringify({
    config, dataDigest,
  })).digest("hex").slice(0, 24);

  return {
    runId, dataDigest, symbol: config.symbol, interval: config.interval, strategy: strategy.id,
    candlesProcessed: candles.length - evaluationStartIndex, trades, equityCurve,
    metrics: {
      startingCapital: config.startingCapital, finalEquity, netProfit,
      totalReturnPct: netProfit / config.startingCapital * 100,
      maxDrawdownPct, winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
      profitFactor, averageTradePct: trades.length
        ? trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length : 0,
      feesPaid, totalTrades: trades.length, winningTrades: wins.length, losingTrades: losses.length,
    },
    assumptions: [
      "Signals are calculated on candle close and orders are filled no earlier than the next candle open.",
      "If stop-loss and take-profit are both touched in one candle, stop-loss is assumed first.",
      "Fees and adverse slippage are applied on both entry and exit.",
      "Maximum notional exposure is capped at 1x current equity; no leverage or liquidation model is used.",
      "Only contiguous, closed historical candles are accepted; missing intervals cause the run to be rejected.",
      "Results are historical simulation only and do not authorize live or PAPER execution.",
    ],
    executionEligible: false,
  };
}
