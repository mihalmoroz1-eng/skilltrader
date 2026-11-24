import type { SignalValidationResult } from "@shared/signalValidation";
import type { PaperAccountInitializeInput, PaperOpenPositionInput } from "@shared/paperExecution";
import type { FuturesMarketProvider } from "../../futures-intelligence/core/FuturesLiquidityTypes";
import type { PaperInstrumentRulesProvider } from "../providers/BinanceUsdMInstrumentRulesProvider";
import {
  calculatePaperUnrealizedPnl, closePaperPosition, PaperExecutionError,
  preparePaperPosition, sumPaperDecimals,
  type PaperAccountConfig, type PaperAccountSnapshot, type PaperSignalRecord,
} from "./PaperExecutionEngine";
import { DrizzlePaperExecutionStore, PaperStateConflictError } from "./DrizzlePaperExecutionStore";

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
function addDecimals(left: string, right: string): string {
  return sumPaperDecimals([left, right]);
}
function formatScaled(value: bigint): string {
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function parseScaled(value: string): bigint {
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = normalized.split(".");
  const scaled = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  return negative ? -scaled : scaled;
}

export class PaperExecutionService {
  constructor(
    private readonly store: DrizzlePaperExecutionStore,
    private readonly rulesProvider: PaperInstrumentRulesProvider,
    private readonly futuresProvider: FuturesMarketProvider,
    private readonly now: () => number = Date.now,
  ) {}

  async initializeAccount(userOpenId: string, input: PaperAccountInitializeInput) {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new PaperExecutionError("Invalid PAPER account clock");
    if (await this.store.getAccount(userOpenId)) throw new PaperExecutionError("PAPER account already exists");
    const config: PaperAccountConfig = {
      startingBalance: input.startingBalance,
      cashBalance: input.startingBalance,
      realizedDailyLoss: "0",
      dailyLossDate: utcDate(now),
      riskPerTradeBps: input.riskPerTradeBps,
      maxDailyLossBps: input.maxDailyLossBps,
      maxGrossExposureBps: input.maxGrossExposureBps,
      maxOpenPositions: input.maxOpenPositions,
      feeBps: input.feeBps,
      slippageBps: input.slippageBps,
    };
    return this.store.createAccount(userOpenId, config, now);
  }

  async recordSignalReview(userOpenId: string, validation: SignalValidationResult): Promise<boolean> {
    if (validation.status !== "reviewable" || !validation.candidate) return false;
    const candidate = validation.candidate;
    const signal: PaperSignalRecord = {
      userOpenId,
      signalId: candidate.signalId,
      marketRunId: candidate.marketRunId,
      validationDigest: validation.provenance.validationDigest,
      marketEvidenceDigest: validation.provenance.marketEvidenceDigest,
      symbol: candidate.symbol,
      interval: candidate.interval,
      direction: candidate.direction,
      thesisCodes: candidate.thesisCodes,
      createdAt: this.now(),
      status: "pending",
    };
    await this.store.recordSignalReview(signal, this.now());
    return true;
  }

  async acceptSignal(userOpenId: string, signalId: string) {
    return this.store.setSignalStatus(userOpenId, signalId, "accepted", this.now());
  }

  async dismissSignal(userOpenId: string, signalId: string) {
    return this.store.setSignalStatus(userOpenId, signalId, "dismissed", this.now());
  }

  private async accountSnapshot(userOpenId: string, now: number): Promise<{
    account: NonNullable<Awaited<ReturnType<DrizzlePaperExecutionStore["getAccount"]>>>;
    openPositions: Awaited<ReturnType<DrizzlePaperExecutionStore["getOpenPositions"]>>;
    snapshot: PaperAccountSnapshot;
    riskDailyLoss: string;
    realizedDailyLossForToday: string;
    currentOpenNotional: string;
  }> {
    const account = await this.store.getAccount(userOpenId);
    if (!account) throw new PaperExecutionError("PAPER account is not initialized");
    const openPositions = await this.store.getOpenPositions(userOpenId);
    const currentOpenNotional = sumPaperDecimals(openPositions.map(position => position.notional));
    const day = utcDate(now);
    const dailyLossForToday = account.dailyLossDate === day ? account.realizedDailyLoss : "0";
    const marks = await Promise.all([...new Set(openPositions.map(position => position.symbol))].map(async symbol => {
      const snapshot = await this.futuresProvider.fetchSnapshot(symbol, 5);
      return [symbol, snapshot.markPrice] as const;
    }));
    const markBySymbol = new Map(marks);
    const unrealized = openPositions.map(position => calculatePaperUnrealizedPnl(
      position, markBySymbol.get(position.symbol)!, account.feeBps, account.slippageBps,
    ).netUnrealizedPnl);
    const equity = addDecimals(addDecimals(account.cashBalance, currentOpenNotional), sumPaperDecimals(unrealized));
    const adverseOpenLoss = sumPaperDecimals(unrealized.map(value => {
      const scaled = parseScaled(value);
      return scaled < 0n ? formatScaled(-scaled) : "0";
    }));
    const riskDailyLoss = addDecimals(dailyLossForToday, adverseOpenLoss);
    const snapshot: PaperAccountSnapshot = {
      ...account, realizedDailyLoss: riskDailyLoss, equity,
      currentOpenNotional, openPositions: openPositions.length, snapshotAt: now,
    };
    if (parseScaled(equity) <= 0n) throw new PaperExecutionError("PAPER account equity is exhausted");
    return { account, openPositions, snapshot, riskDailyLoss, realizedDailyLossForToday: dailyLossForToday, currentOpenNotional };
  }

  async openPosition(userOpenId: string, input: PaperOpenPositionInput) {
    const now = this.now();
    const [account, signal] = await Promise.all([
      this.store.getAccount(userOpenId),
      this.store.getSignal(userOpenId, input.signalId),
    ]);
    if (!account) throw new PaperExecutionError("Initialize a PAPER account before opening a position");
    if (!signal || signal.status !== "accepted") {
      throw new PaperExecutionError("Signal must be manually accepted before PAPER opening");
    }
    const [instrument, market] = await Promise.all([
      this.rulesProvider.getRules(signal.symbol),
      this.futuresProvider.fetchSnapshot(signal.symbol, 5),
    ]);
    const riskNow = this.now();
    if (!Number.isSafeInteger(signal.createdAt) || signal.createdAt > riskNow || riskNow - signal.createdAt > 5 * 60_000) {
      throw new PaperExecutionError("Signal approval expired; generate and approve a fresh signal");
    }
    const snapshot = await this.accountSnapshot(userOpenId, riskNow);
    const nowAfterSnapshot = this.now();
    if (nowAfterSnapshot - signal.createdAt > 5 * 60_000) {
      throw new PaperExecutionError("Signal approval expired during risk evaluation; refresh the signal");
    }
    snapshot.snapshot.snapshotAt = nowAfterSnapshot;
    const result = preparePaperPosition({
      userOpenId, account: snapshot.snapshot, signal, instrument,
      markPrice: market.markPrice, stopPrice: input.stopPrice, targetPrice: input.targetPrice,
      currentOpenPositions: snapshot.openPositions.length, now: nowAfterSnapshot,
    });
    if (result.status !== "opened" || !result.position || !result.accountCashBalanceAfter) return result;

    const position = await this.store.openPositionAtomic({
      userOpenId, signalId: signal.signalId, position: result.position,
      expectedCashBalance: account.cashBalance,
      expectedDailyLoss: account.realizedDailyLoss,
      expectedDailyLossDate: account.dailyLossDate,
      expectedOpenNotional: snapshot.currentOpenNotional,
      expectedOpenPositions: snapshot.openPositions.length,
      newCashBalance: result.accountCashBalanceAfter,
      newDailyLoss: snapshot.realizedDailyLossForToday,
      dailyLossDate: utcDate(nowAfterSnapshot),
      expectedSignalCreatedAt: signal.createdAt,
      now: nowAfterSnapshot,
    });
    return { ...result, position };
  }

  async closePosition(userOpenId: string, positionId: number, reason: "manual" | "stop_loss" | "take_profit" = "manual") {
    const now = this.now();
    const [account, position] = await Promise.all([
      this.store.getAccount(userOpenId),
      this.store.getPosition(userOpenId, positionId),
    ]);
    if (!account || !position || position.status !== "open") {
      throw new PaperExecutionError("Open PAPER position was not found");
    }
    const market = await this.futuresProvider.fetchSnapshot(position.symbol, 5);
    const day = utcDate(now);
    const dailyLossForToday = account.dailyLossDate === day ? account.realizedDailyLoss : "0";
    const result = closePaperPosition({
      position, markPrice: market.markPrice,
      accountCashBalance: account.cashBalance,
      realizedDailyLoss: dailyLossForToday,
      feeBps: account.feeBps, slippageBps: account.slippageBps,
      now, reason,
    });
    const closedPosition = await this.store.closePositionAtomic({
      userOpenId, positionId, closedPosition: result.position,
      expectedCashBalance: account.cashBalance,
      expectedDailyLoss: account.realizedDailyLoss,
      expectedDailyLossDate: account.dailyLossDate,
      newCashBalance: result.cashBalanceAfter,
      newDailyLoss: result.realizedDailyLossAfter,
      dailyLossDate: day,
      now,
    });
    return { ...result, position: closedPosition };
  }

  async syncPositions(userOpenId: string) {
    const positions = await this.store.getOpenPositions(userOpenId);
    const closed = [];
    for (const position of positions) {
      const snapshot = await this.futuresProvider.fetchSnapshot(position.symbol, 5);
      const mark = Number(snapshot.markPrice);
      const stop = Number(position.stopPrice);
      const target = Number(position.targetPrice);
      const reason = position.side === "LONG"
        ? mark <= stop ? "stop_loss" : mark >= target ? "take_profit" : null
        : mark >= stop ? "stop_loss" : mark <= target ? "take_profit" : null;
      if (reason) closed.push(await this.closePosition(userOpenId, position.id!, reason));
    }
    return { checked: positions.length, closed, executionMode: "PAPER" as const, exchangeOrderSent: false as const };
  }

  async getPortfolio(userOpenId: string) {
    const now = this.now();
    const portfolio = await this.store.getPortfolio(userOpenId);
    if (!portfolio.account) return { ...portfolio, equity: null, currentOpenNotional: "0", executionMode: "PAPER" as const };
    const snapshot = await this.accountSnapshot(userOpenId, now);
    return {
      account: snapshot.account,
      positions: portfolio.positions,
      signals: portfolio.signals,
      equity: snapshot.snapshot.equity,
      currentOpenNotional: snapshot.currentOpenNotional,
      openPositions: snapshot.openPositions.length,
      executionMode: "PAPER" as const,
      exchangeOrderSent: false as const,
      executionEligible: false as const,
    };
  }
}
