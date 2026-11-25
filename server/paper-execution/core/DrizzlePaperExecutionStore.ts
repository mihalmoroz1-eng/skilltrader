import { and, asc, eq, sql } from "drizzle-orm";
import { paperAccounts, paperEvents, paperPositions, paperSignalReviews } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type {
  PaperAccountConfig, PaperPosition, PaperSignalRecord,
} from "./PaperExecutionEngine";

export class PaperStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperStateConflictError";
  }
}

export type PaperAccountRecord = PaperAccountConfig & {
  userOpenId: string;
  currency: string;
};

function parseScaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}
function formatScaled(value: bigint): string {
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function mapSignal(row: typeof paperSignalReviews.$inferSelect): PaperSignalRecord {
  let thesisCodes: string[];
  try {
    const parsed: unknown = JSON.parse(row.thesisCodes);
    if (!Array.isArray(parsed) || parsed.some(code => typeof code !== "string")) throw new Error("invalid");
    thesisCodes = parsed;
  } catch {
    throw new Error("Stored PAPER signal thesis codes are malformed");
  }
  return {
    userOpenId: row.userOpenId, signalId: row.signalId, marketRunId: row.marketRunId,
    validationDigest: row.validationDigest, marketEvidenceDigest: row.marketEvidenceDigest,
    symbol: row.symbol, interval: row.interval, direction: row.direction,
    thesisCodes, createdAt: row.createdAt.getTime(), status: row.status,
  };
}
function mapPosition(row: typeof paperPositions.$inferSelect): PaperPosition {
  return {
    id: row.id, userOpenId: row.userOpenId, signalId: row.signalId, marketRunId: row.marketRunId,
    symbol: row.symbol, interval: row.interval, side: row.side, quantity: row.quantity,
    notional: row.notional, entryPrice: row.entryPrice, stopPrice: row.stopPrice,
    targetPrice: row.targetPrice ?? "", contractMultiplier: row.contractMultiplier,
    tickSize: row.tickSize, entryFee: row.entryFee, status: row.status,
    openedAt: row.openedAt, closedAt: row.closedAt ?? undefined, exitPrice: row.exitPrice ?? undefined,
    grossPnl: row.grossPnl ?? undefined, netPnl: row.netPnl ?? undefined,
    feesPaid: row.feesPaid, exitReason: row.exitReason ?? undefined,
  };
}

export class DrizzlePaperExecutionStore {
  async createAccount(userOpenId: string, config: PaperAccountConfig, now: number): Promise<PaperAccountRecord> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    await db.transaction(async tx => {
      await tx.insert(paperAccounts).values({
        userOpenId, currency: "USDT", startingBalance: config.startingBalance,
        cashBalance: config.cashBalance, realizedDailyLoss: config.realizedDailyLoss,
        dailyLossDate: config.dailyLossDate, riskPerTradeBps: config.riskPerTradeBps,
        maxDailyLossBps: config.maxDailyLossBps, maxGrossExposureBps: config.maxGrossExposureBps,
        maxOpenPositions: config.maxOpenPositions, feeBps: config.feeBps, slippageBps: config.slippageBps,
      });
      await tx.insert(paperEvents).values({
        userOpenId, eventType: "account_initialized", entityId: null,
        eventPayload: JSON.stringify({ currency: "USDT", startingBalance: config.startingBalance }),
        occurredAt: now,
      });
    });
    return { userOpenId, currency: "USDT", ...config };
  }

  async getAccount(userOpenId: string): Promise<PaperAccountRecord | null> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    const rows = await db.select().from(paperAccounts).where(eq(paperAccounts.userOpenId, userOpenId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      userOpenId: row.userOpenId, currency: row.currency,
      startingBalance: row.startingBalance, cashBalance: row.cashBalance,
      realizedDailyLoss: row.realizedDailyLoss, dailyLossDate: row.dailyLossDate,
      riskPerTradeBps: row.riskPerTradeBps, maxDailyLossBps: row.maxDailyLossBps,
      maxGrossExposureBps: row.maxGrossExposureBps, maxOpenPositions: row.maxOpenPositions,
      feeBps: row.feeBps, slippageBps: row.slippageBps,
    };
  }

  async getSignal(userOpenId: string, signalId: string): Promise<PaperSignalRecord | null> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    const rows = await db.select().from(paperSignalReviews).where(and(
      eq(paperSignalReviews.userOpenId, userOpenId), eq(paperSignalReviews.signalId, signalId),
    )).limit(1);
    return rows[0] ? mapSignal(rows[0]) : null;
  }

  async recordSignalReview(signal: PaperSignalRecord, now: number): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    await db.insert(paperSignalReviews).values({
      userOpenId: signal.userOpenId, signalId: signal.signalId, marketRunId: signal.marketRunId,
      validationDigest: signal.validationDigest, marketEvidenceDigest: signal.marketEvidenceDigest,
      symbol: signal.symbol, interval: signal.interval, direction: signal.direction,
      thesisCodes: JSON.stringify(signal.thesisCodes), status: "pending", createdAt: new Date(signal.createdAt),
    }).onDuplicateKeyUpdate({ set: { signalId: sql`signalId` } });
    await db.insert(paperEvents).values({
      userOpenId: signal.userOpenId, eventType: "signal_recorded", entityId: signal.signalId,
      eventPayload: JSON.stringify({ marketRunId: signal.marketRunId, validationDigest: signal.validationDigest }),
      occurredAt: now,
    });
  }

  async setSignalStatus(userOpenId: string, signalId: string, status: "accepted" | "dismissed", now: number): Promise<PaperSignalRecord> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    return db.transaction(async tx => {
      const rows = await tx.select().from(paperSignalReviews).where(and(
        eq(paperSignalReviews.userOpenId, userOpenId), eq(paperSignalReviews.signalId, signalId),
      )).limit(1).for("update");
      const row = rows[0];
      if (!row || row.status !== "pending") throw new PaperStateConflictError("Signal is missing or no longer pending");
      await tx.update(paperSignalReviews).set({ status }).where(eq(paperSignalReviews.id, row.id));
      await tx.insert(paperEvents).values({
        userOpenId, eventType: status === "accepted" ? "signal_accepted" : "signal_dismissed",
        entityId: signalId, eventPayload: JSON.stringify({ status }), occurredAt: now,
      });
      return mapSignal({ ...row, status });
    });
  }

  async getOpenPositions(userOpenId: string): Promise<PaperPosition[]> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    const rows = await db.select().from(paperPositions).where(and(
      eq(paperPositions.userOpenId, userOpenId), eq(paperPositions.status, "open"),
    )).orderBy(asc(paperPositions.openedAt));
    return rows.map(mapPosition);
  }

  async getPosition(userOpenId: string, positionId: number): Promise<PaperPosition | null> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    const rows = await db.select().from(paperPositions).where(and(
      eq(paperPositions.userOpenId, userOpenId), eq(paperPositions.id, positionId),
    )).limit(1);
    return rows[0] ? mapPosition(rows[0]) : null;
  }

  async listPositions(userOpenId: string, limit = 100): Promise<PaperPosition[]> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    const rows = await db.select().from(paperPositions).where(eq(paperPositions.userOpenId, userOpenId))
      .orderBy(asc(paperPositions.openedAt)).limit(limit);
    return rows.map(mapPosition);
  }

  async openPositionAtomic(input: {
    userOpenId: string; signalId: string; position: PaperPosition;
    expectedCashBalance: string; expectedDailyLoss: string; expectedDailyLossDate: string;
    expectedOpenNotional: string; expectedOpenPositions: number;
    newCashBalance: string; newDailyLoss: string; dailyLossDate: string;
    expectedSignalCreatedAt: number; now: number;
  }): Promise<PaperPosition> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    return db.transaction(async tx => {
      const accountRows = await tx.select().from(paperAccounts).where(eq(paperAccounts.userOpenId, input.userOpenId)).limit(1).for("update");
      const account = accountRows[0];
      const signalRows = await tx.select().from(paperSignalReviews).where(and(
        eq(paperSignalReviews.userOpenId, input.userOpenId), eq(paperSignalReviews.signalId, input.signalId),
      )).limit(1).for("update");
      const signal = signalRows[0];
      const openRows = await tx.select().from(paperPositions).where(and(
        eq(paperPositions.userOpenId, input.userOpenId), eq(paperPositions.status, "open"),
      )).for("update");
      const openNotional = formatScaled(openRows.reduce((sum, row) => sum + parseScaled(row.notional), 0n));
      if (!account || !signal || signal.status !== "accepted") {
        throw new PaperStateConflictError("PAPER account or accepted signal changed before position open");
      }
      const signalCreatedAt = signal.createdAt.getTime();
      if (signalCreatedAt !== input.expectedSignalCreatedAt || input.now < signalCreatedAt || input.now - signalCreatedAt > 5 * 60_000) {
        throw new PaperStateConflictError("Signal approval expired before position open");
      }
      if (account.cashBalance !== input.expectedCashBalance ||
          account.realizedDailyLoss !== input.expectedDailyLoss ||
          account.dailyLossDate !== input.expectedDailyLossDate ||
          openRows.length !== input.expectedOpenPositions || openNotional !== input.expectedOpenNotional) {
        throw new PaperStateConflictError("PAPER account changed during risk evaluation; recalculate before opening");
      }
      await tx.update(paperAccounts).set({
        cashBalance: input.newCashBalance, realizedDailyLoss: input.newDailyLoss, dailyLossDate: input.dailyLossDate,
      }).where(eq(paperAccounts.userOpenId, input.userOpenId));
      await tx.update(paperSignalReviews).set({ status: "consumed" }).where(eq(paperSignalReviews.id, signal.id));
      await tx.insert(paperPositions).values({
        userOpenId: input.userOpenId, signalId: input.position.signalId,
        marketRunId: input.position.marketRunId, symbol: input.position.symbol,
        interval: input.position.interval, side: input.position.side,
        quantity: input.position.quantity, notional: input.position.notional,
        entryPrice: input.position.entryPrice, stopPrice: input.position.stopPrice,
        targetPrice: input.position.targetPrice, contractMultiplier: input.position.contractMultiplier,
        tickSize: input.position.tickSize, entryFee: input.position.entryFee,
        status: "open", openedAt: input.position.openedAt, feesPaid: input.position.feesPaid,
      });
      await tx.insert(paperEvents).values({
        userOpenId: input.userOpenId, eventType: "position_opened", entityId: input.signalId,
        eventPayload: JSON.stringify({ symbol: input.position.symbol, side: input.position.side, quantity: input.position.quantity }),
        occurredAt: input.now,
      });
      const rows = await tx.select().from(paperPositions).where(and(
        eq(paperPositions.userOpenId, input.userOpenId), eq(paperPositions.signalId, input.signalId),
      )).limit(1);
      if (!rows[0]) throw new Error("PAPER position insert did not return a record");
      return mapPosition(rows[0]);
    });
  }

  async closePositionAtomic(input: {
    userOpenId: string; positionId: number; closedPosition: PaperPosition;
    expectedCashBalance: string; expectedDailyLoss: string; expectedDailyLossDate: string;
    newCashBalance: string; newDailyLoss: string; dailyLossDate: string; now: number;
  }): Promise<PaperPosition> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    return db.transaction(async tx => {
      const accountRows = await tx.select().from(paperAccounts).where(eq(paperAccounts.userOpenId, input.userOpenId)).limit(1).for("update");
      const account = accountRows[0];
      const positionRows = await tx.select().from(paperPositions).where(and(
        eq(paperPositions.userOpenId, input.userOpenId), eq(paperPositions.id, input.positionId),
      )).limit(1).for("update");
      const position = positionRows[0];
      if (!account || !position || position.status !== "open") {
        throw new PaperStateConflictError("PAPER account or open position changed before close");
      }
      if (account.cashBalance !== input.expectedCashBalance ||
          account.realizedDailyLoss !== input.expectedDailyLoss ||
          account.dailyLossDate !== input.expectedDailyLossDate) {
        throw new PaperStateConflictError("PAPER account changed during close calculation; retry with a fresh snapshot");
      }
      await tx.update(paperAccounts).set({
        cashBalance: input.newCashBalance, realizedDailyLoss: input.newDailyLoss, dailyLossDate: input.dailyLossDate,
      }).where(eq(paperAccounts.userOpenId, input.userOpenId));
      await tx.update(paperPositions).set({
        status: "closed", closedAt: input.closedPosition.closedAt!,
        exitPrice: input.closedPosition.exitPrice!, grossPnl: input.closedPosition.grossPnl!,
        netPnl: input.closedPosition.netPnl!, feesPaid: input.closedPosition.feesPaid,
        exitReason: input.closedPosition.exitReason!,
      }).where(eq(paperPositions.id, input.positionId));
      await tx.insert(paperEvents).values({
        userOpenId: input.userOpenId, eventType: "position_closed", entityId: String(input.positionId),
        eventPayload: JSON.stringify({ exitPrice: input.closedPosition.exitPrice, netPnl: input.closedPosition.netPnl, reason: input.closedPosition.exitReason }),
        occurredAt: input.now,
      });
      const rows = await tx.select().from(paperPositions).where(eq(paperPositions.id, input.positionId)).limit(1);
      if (!rows[0]) throw new Error("Closed PAPER position could not be reloaded");
      return mapPosition(rows[0]);
    });
  }


  async listSignals(userOpenId: string, limit = 50): Promise<PaperSignalRecord[]> {
    const db = await getDb();
    if (!db) throw new Error("PAPER database is unavailable");
    const rows = await db.select().from(paperSignalReviews).where(eq(paperSignalReviews.userOpenId, userOpenId))
      .orderBy(asc(paperSignalReviews.createdAt)).limit(limit);
    return rows.map(mapSignal);
  }

  async getPortfolio(userOpenId: string) {
    const [account, positions, signals] = await Promise.all([
      this.getAccount(userOpenId), this.listPositions(userOpenId), this.listSignals(userOpenId),
    ]);
    return { account, positions, signals };
  }
}
