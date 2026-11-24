import { createHash } from "node:crypto";
import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";
import { validateCandles } from "../../market-data/core/MarketDataValidator";
import { calculateEMA } from "../../market-data/core/TechnicalIndicators";

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
  exitReason: "stop_loss" | "take_profit" | "opposite_signal" | "end_of_data";
};

export type BacktestResult = {
  runId: string;
  symbol: string;
  interval: MarketInterval;
  strategy: "ema_crossover";
  candlesProcessed: number;
  trades: BacktestTrade[];
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
  finitePositive(config.startingCapital, "startingCapital");
  if (!Number.isInteger(config.fastEmaPeriod) || !Number.isInteger(config.slowEmaPeriod) ||
      config.fastEmaPeriod < 2 || config.slowEmaPeriod <= config.fastEmaPeriod || config.slowEmaPeriod > 300) {
    throw new BacktestInputError("EMA periods are invalid");
  }
  if (!/^[A-Z0-9]{2,20}$/.test(config.symbol) ||
      !Number.isInteger(config.riskBps) || config.riskBps < 1 || config.riskBps > 1_000 || config.riskBps >= config.stopLossBps ||
      !Number.isInteger(config.stopLossBps) || config.stopLossBps < 10 || config.stopLossBps > 5_000 ||
      !Number.isInteger(config.takeProfitBps) || config.takeProfitBps < 10 || config.takeProfitBps > 10_000 ||
      !Number.isInteger(config.feeBps) || config.feeBps < 0 || config.feeBps > 100 ||
      !Number.isInteger(config.slippageBps) || config.slippageBps < 0 || config.slippageBps > 100) {
    throw new BacktestInputError("Risk, stop, target, fee or slippage parameters are invalid");
  }
  if (candles.length > 50_000) throw new BacktestInputError("Backtest is limited to 50,000 candles");
  if (candles.length <= config.slowEmaPeriod + 1) throw new BacktestInputError("Insufficient candles for EMA warm-up");
  validateCandles(candles);

  for (let i = 0; i < candles.length; i += 1) {
    const expectedClose = nextOpenTime(candles[i].openTime, config.interval) - 1;
    if (candles[i].closeTime !== expectedClose) throw new BacktestInputError(`Candle ${i} does not match the requested interval`);
    if (i > 0 && candles[i].openTime !== nextOpenTime(candles[i - 1].openTime, config.interval)) {
      throw new BacktestInputError("Historical series contains a gap; backtest requires contiguous candles");
    }
  }

  const closes = candles.map(candle => Number(candle.close));
  if (closes.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new BacktestInputError("Candle prices cannot be represented safely");
  }
  const fast = calculateEMA(closes, config.fastEmaPeriod);
  const slow = calculateEMA(closes, config.slowEmaPeriod);
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
  const equityCurve: number[] = [];

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

  for (let i = config.slowEmaPeriod + 1; i < candles.length; i += 1) {
    const candle = candles[i];
    const signalIndex = i - 1;
    const priorSignalIndex = i - 2;
    const crossUp = fast[priorSignalIndex] !== null && slow[priorSignalIndex] !== null &&
      fast[signalIndex] !== null && slow[signalIndex] !== null &&
      fast[priorSignalIndex]! <= slow[priorSignalIndex]! && fast[signalIndex]! > slow[signalIndex]!;
    const crossDown = fast[priorSignalIndex] !== null && slow[priorSignalIndex] !== null &&
      fast[signalIndex] !== null && slow[signalIndex] !== null &&
      fast[priorSignalIndex]! >= slow[priorSignalIndex]! && fast[signalIndex]! < slow[signalIndex]!;

    const hadPositionAtStart = position !== null;
    if (position && ((position.side === "LONG" && crossDown) || (position.side === "SHORT" && crossUp))) {
      closePosition(candle, Number(candle.open), candle.openTime, "opposite_signal");
    }

    if (!hadPositionAtStart && !position && (crossUp || (config.allowShort && crossDown))) {
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
    equityCurve.push(markToMarket);
  }

  if (position) closePosition(candles[candles.length - 1], Number(candles[candles.length - 1].close), candles[candles.length - 1].closeTime, "end_of_data");
  peakEquity = Math.max(peakEquity, equity);
  if (peakEquity > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - equity) / peakEquity * 100);

  const finalEquity = equity;
  const netProfit = finalEquity - config.startingCapital;
  const wins = trades.filter(trade => trade.netPnl > 0);
  const losses = trades.filter(trade => trade.netPnl < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const profitFactor = grossLosses === 0 ? (grossWins > 0 ? null : 0) : grossWins / grossLosses;
  const runId = createHash("sha256").update(JSON.stringify({
    config, firstOpenTime: candles[0].openTime, lastOpenTime: candles[candles.length - 1].openTime,
    count: candles.length,
  })).digest("hex").slice(0, 24);

  return {
    runId, symbol: config.symbol, interval: config.interval, strategy: "ema_crossover",
    candlesProcessed: candles.length, trades,
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
