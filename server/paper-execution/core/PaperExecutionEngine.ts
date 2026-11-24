import { evaluateAccountRisk } from "../../account-risk/core/AccountRiskEngine";
import type { AccountRiskResult } from "@shared/accountRisk";

const SCALE = 100_000_000n;
function parse(value: string): bigint {
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value) || value.length > 40) {
    throw new PaperExecutionError("Invalid fixed-point decimal");
  }
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = normalized.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  return negative ? -scaled : scaled;
}
function format(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
function mul(left: bigint, right: bigint): bigint { return left * right / SCALE; }
function bps(value: bigint, rate: number): bigint { return value * BigInt(rate) / 10_000n; }
function slippagePrice(price: bigint, rate: number, adverseUp: boolean, tick: bigint): bigint {
  const factor = BigInt(10_000 + (adverseUp ? rate : -rate));
  const slipped = price * factor / 10_000n;
  const remainder = slipped % tick;
  if (remainder === 0n) return slipped;
  return adverseUp ? slipped + tick - remainder : slipped - remainder;
}
function alignToTick(price: string, tick: string): boolean {
  const p = parse(price), t = parse(tick);
  return t > 0n && p % t === 0n;
}

export class PaperExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperExecutionError";
  }
}

export type PaperAccountConfig = {
  startingBalance: string;
  cashBalance: string;
  realizedDailyLoss: string;
  dailyLossDate: string;
  riskPerTradeBps: number;
  maxDailyLossBps: number;
  maxGrossExposureBps: number;
  maxOpenPositions: number;
  feeBps: number;
  slippageBps: number;
};

export type PaperSignalRecord = {
  userOpenId: string;
  signalId: string;
  marketRunId: string;
  validationDigest: string;
  marketEvidenceDigest: string;
  symbol: string;
  interval: string;
  direction: "LONG" | "SHORT";
  thesisCodes: string[];
  status: "pending" | "accepted" | "dismissed" | "consumed";
};

export type PaperInstrumentRules = {
  symbol: string;
  contractMultiplier: string;
  quantityStep: string;
  minimumQuantity: string;
  tickSize: string;
};

export type PaperAccountSnapshot = PaperAccountConfig & {
  equity: string;
  currentOpenNotional: string;
  openPositions: number;
  snapshotAt: number;
};

export type PaperPosition = {
  id?: number;
  userOpenId: string;
  signalId: string;
  marketRunId: string;
  symbol: string;
  interval: string;
  side: "LONG" | "SHORT";
  quantity: string;
  notional: string;
  entryPrice: string;
  stopPrice: string;
  targetPrice: string;
  contractMultiplier: string;
  entryFee: string;
  status: "open" | "closed";
  openedAt: number;
  closedAt?: number;
  exitPrice?: string;
  grossPnl?: string;
  netPnl?: string;
  feesPaid: string;
  exitReason?: "manual" | "stop_loss" | "take_profit" | "end_of_data";
};

export type PaperOpenResult = {
  status: "opened" | "rejected";
  risk: AccountRiskResult;
  position: PaperPosition | null;
  accountCashBalanceAfter: string | null;
  executionMode: "PAPER";
  exchangeOrderSent: false;
  executionEligible: false;
};

export type PaperCloseResult = {
  position: PaperPosition;
  cashBalanceAfter: string;
  realizedDailyLossAfter: string;
  executionMode: "PAPER";
  exchangeOrderSent: false;
  executionEligible: false;
};

export function preparePaperPosition(input: {
  userOpenId: string;
  account: PaperAccountSnapshot;
  signal: PaperSignalRecord;
  instrument: PaperInstrumentRules;
  markPrice: string;
  stopPrice: string;
  targetPrice: string;
  currentOpenPositions: number;
  now: number;
}): PaperOpenResult {
  const { account, signal, instrument } = input;
  if (signal.userOpenId !== input.userOpenId || signal.status !== "accepted") {
    throw new PaperExecutionError("Signal must be manually accepted by the authenticated user");
  }
  if (signal.symbol !== instrument.symbol || signal.symbol !== signal.symbol.toUpperCase()) {
    throw new PaperExecutionError("Signal and instrument symbol do not match");
  }
  if (!alignToTick(input.markPrice, instrument.tickSize) ||
      !alignToTick(input.stopPrice, instrument.tickSize) ||
      !alignToTick(input.targetPrice, instrument.tickSize)) {
    throw new PaperExecutionError("Entry, stop and target must align to the instrument tick size");
  }

  const entryRaw = parse(input.markPrice);
  const stop = parse(input.stopPrice);
  const target = parse(input.targetPrice);
  const tick = parse(instrument.tickSize);\n  const entry = slippagePrice(entryRaw, account.slippageBps, signal.direction === "LONG", tick);
  if (signal.direction === "LONG" ? (stop >= entry || target <= entry) : (stop <= entry || target >= entry)) {
    throw new PaperExecutionError("Stop and target must be on the correct side of the PAPER entry price");
  }

  const roundTripCostBps = Math.min(2_000, (account.feeBps + account.slippageBps) * 2);
  const risk = evaluateAccountRisk({
    account: {
      equity: account.equity,
      realizedDailyLoss: account.realizedDailyLoss,
      currentOpenNotional: account.currentOpenNotional,
      openPositions: input.currentOpenPositions,
      maxOpenPositions: account.maxOpenPositions,
      riskPerTradeBps: account.riskPerTradeBps,
      maxDailyLossBps: account.maxDailyLossBps,
      maxGrossExposureBps: account.maxGrossExposureBps,
      snapshotAt: account.snapshotAt,
    },
    candidate: {
      direction: signal.direction,
      entryPrice: format(entry),
      stopPrice: format(stop),
      contractMultiplier: instrument.contractMultiplier,
      quantityStep: instrument.quantityStep,
      minimumQuantity: instrument.minimumQuantity,
      roundTripCostBps,
    },
    evaluatedAt: input.now,
  });

  if (risk.status !== "approved_for_paper_review" || !risk.sizing.quantity || !risk.sizing.notional) {
    return {
      status: "rejected", risk, position: null, accountCashBalanceAfter: null,
      executionMode: "PAPER", exchangeOrderSent: false, executionEligible: false,
    };
  }

  const quantity = parse(risk.sizing.quantity);
  const notional = parse(risk.sizing.notional);
  const entryFee = bps(notional, account.feeBps);
  const cashBalance = parse(account.cashBalance);
  if (cashBalance < notional + entryFee) {
    throw new PaperExecutionError("Insufficient free PAPER cash after reserving notional and entry fee");
  }

  const position: PaperPosition = {
    userOpenId: input.userOpenId,
    signalId: signal.signalId,
    marketRunId: signal.marketRunId,
    symbol: signal.symbol,
    interval: signal.interval,
    side: signal.direction,
    quantity: format(quantity),
    notional: format(notional),
    entryPrice: format(entry),
    stopPrice: format(stop),
    targetPrice: format(target),
    contractMultiplier: instrument.contractMultiplier,
    entryFee: format(entryFee),
    status: "open",
    openedAt: input.now,
    feesPaid: format(entryFee),
  };

  return {
    status: "opened", risk, position,
    accountCashBalanceAfter: format(cashBalance - notional - entryFee),
    executionMode: "PAPER", exchangeOrderSent: false, executionEligible: false,
  };
}

export function sumPaperDecimals(values: string[]): string {
  return format(values.reduce((sum, value) => sum + parse(value), 0n));
}

export function calculatePaperUnrealizedPnl(
  position: PaperPosition,
  markPrice: string,
  feeBps: number,
  slippageBps: number,
): { grossPnl: string; estimatedExitFee: string; netUnrealizedPnl: string } {
  if (position.status !== "open") throw new PaperExecutionError("Only open PAPER positions can be marked");
  const mark = parse(markPrice);
  const exit = slippagePrice(mark, slippageBps, position.side === "SHORT", parse(position.tickSize));
  const entry = parse(position.entryPrice);
  const quantity = parse(position.quantity);
  const multiplier = parse(position.contractMultiplier);
  const sign = position.side === "LONG" ? 1n : -1n;
  const grossPnl = mul(mul(exit - entry, quantity), multiplier) * sign;
  const exitNotional = mul(mul(exit, quantity), multiplier);
  const estimatedExitFee = bps(exitNotional, feeBps);
  return {
    grossPnl: format(grossPnl),
    estimatedExitFee: format(estimatedExitFee),
    netUnrealizedPnl: format(grossPnl - estimatedExitFee),
  };
}

export function closePaperPosition(input: {
  position: PaperPosition;
  markPrice: string;
  accountCashBalance: string;
  realizedDailyLoss: string;
  feeBps: number;
  slippageBps: number;
  now: number;
  reason?: PaperPosition["exitReason"];
}): PaperCloseResult {
  const position = input.position;
  if (position.status !== "open") throw new PaperExecutionError("PAPER position is not open");
  if (!Number.isSafeInteger(input.now) || input.now < position.openedAt) {
    throw new PaperExecutionError("PAPER close time is invalid");
  }
  const mark = parse(input.markPrice);
  const exit = slippagePrice(mark, input.slippageBps, position.side === "SHORT", parse(position.tickSize));
  const entry = parse(position.entryPrice);
  const quantity = parse(position.quantity);
  const multiplier = parse(position.contractMultiplier);
  const notional = parse(position.notional);
  const sign = position.side === "LONG" ? 1n : -1n;
  const grossPnl = mul(mul(exit - entry, quantity), multiplier) * sign;
  const exitNotional = mul(mul(exit, quantity), multiplier);
  const exitFee = bps(exitNotional, input.feeBps);
  const entryFee = parse(position.entryFee);
  const netPnl = grossPnl - entryFee - exitFee;
  const cashAfter = parse(input.accountCashBalance) + notional + grossPnl - exitFee;
  const dailyLoss = parse(input.realizedDailyLoss);
  const nextDailyLoss = netPnl < 0n ? dailyLoss + (-netPnl) : dailyLoss;
  const closed: PaperPosition = {
    ...position, status: "closed", closedAt: input.now,
    exitPrice: format(exit), grossPnl: format(grossPnl), netPnl: format(netPnl),
    feesPaid: format(entryFee + exitFee), exitReason: input.reason ?? "manual",
  };
  return {
    position: closed, cashBalanceAfter: format(cashAfter),
    realizedDailyLossAfter: format(nextDailyLoss),
    executionMode: "PAPER", exchangeOrderSent: false, executionEligible: false,
  };
}
