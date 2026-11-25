import { describe, expect, it } from "vitest";
import { calculatePaperMarkedNotional, calculatePaperUnrealizedPnl, closePaperPosition, PaperExecutionError, preparePaperPosition, sumPaperDecimals } from "../core/PaperExecutionEngine";
import type { PaperAccountSnapshot, PaperInstrumentRules, PaperSignalRecord } from "../core/PaperExecutionEngine";

const now = 1_800_000_000_000;
const account: PaperAccountSnapshot = {
  startingBalance: "10000", cashBalance: "10000", equity: "10000",
  realizedDailyLoss: "0", dailyLossDate: "2027-01-15",
  riskPerTradeBps: 50, maxDailyLossBps: 200, maxGrossExposureBps: 10000,
  maxOpenPositions: 3, feeBps: 5, slippageBps: 5,
  currentOpenNotional: "0", openPositions: 0, snapshotAt: now,
};
const signal: PaperSignalRecord = {
  userOpenId: "user-1", signalId: "a".repeat(24), marketRunId: "market-run",
  validationDigest: "b".repeat(64), marketEvidenceDigest: "c".repeat(64),
  symbol: "BTCUSDT", interval: "15m", direction: "LONG",
  thesisCodes: ["close_above_ema20", "ema20_above_ema50", "trend_structure_up"], createdAt: now - 60_000, status: "accepted",
};
const instrument: PaperInstrumentRules = {
  symbol: "BTCUSDT", contractMultiplier: "1", quantityStep: "0.001",
  minimumQuantity: "0.001", tickSize: "0.1",
};

describe("PAPER execution engine", () => {
  it("sizes a manually accepted signal with Account Risk Engine and creates a virtual position", () => {
    const result = preparePaperPosition({
      userOpenId: "user-1", account, signal, instrument,
      markPrice: "100.0", stopPrice: "98.0", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    });
    expect(result.status).toBe("opened");
    expect(result.position?.status).toBe("open");
    expect(result.position?.quantity).toMatch(/^[0-9]+/);
    expect(result.exchangeOrderSent).toBe(false);
    expect(result.executionEligible).toBe(false);
  });

  it("rejects a signal that has not been manually accepted", () => {
    expect(() => preparePaperPosition({
      userOpenId: "user-1", account, signal: { ...signal, status: "pending" },
      instrument, markPrice: "100.0", stopPrice: "98.0", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    })).toThrow(PaperExecutionError);
  });

  it("rounds a non-tick mark reference to an adverse tick-aligned simulated fill", () => {
    const result = preparePaperPosition({
      userOpenId: "user-1", account, signal, instrument,
      markPrice: "100.05", stopPrice: "98.0", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    });
    expect(result.status).toBe("opened");
    expect(result.position?.entryPrice).toBe("100.2");
  });

  it("rejects incorrect stop and target direction", () => {
    expect(() => preparePaperPosition({
      userOpenId: "user-1", account, signal, instrument,
      markPrice: "100.0", stopPrice: "101.0", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    })).toThrow(/correct side/);
  });

  it("rejects prices that do not align to exchange tick size", () => {
    expect(() => preparePaperPosition({
      userOpenId: "user-1", account, signal, instrument,
      markPrice: "100.0", stopPrice: "98.05", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    })).toThrow(/tick size/);
  });

  it("uses current mark notional rather than entry notional for gross exposure", () => {
    const opened = preparePaperPosition({
      userOpenId: "user-1", account, signal, instrument,
      markPrice: "100.0", stopPrice: "98.0", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    });
    const position = opened.position!;
    const marked = calculatePaperMarkedNotional(position, "110.0");
    expect(Number(marked)).toBeGreaterThan(Number(position.notional));
    expect(Number(calculatePaperMarkedNotional(position, "90.0"))).toBeLessThan(Number(position.notional));
  });

  it("marks open positions to market and preserves signed losses in fixed-point sums", () => {
    const opened = preparePaperPosition({
      userOpenId: "user-1", account, signal, instrument,
      markPrice: "100.0", stopPrice: "98.0", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    });
    const mark = calculatePaperUnrealizedPnl(opened.position!, "95.0", account.feeBps, account.slippageBps);
    expect(Number(mark.netUnrealizedPnl)).toBeLessThan(0);
    expect(sumPaperDecimals(["100", "-25.5"])).toBe("74.5");
  });

  it("closes a virtual position and accounts for PnL and fees", () => {
    const opened = preparePaperPosition({
      userOpenId: "user-1", account, signal, instrument,
      markPrice: "100.0", stopPrice: "98.0", targetPrice: "104.0",
      currentOpenPositions: 0, now,
    });
    expect(opened.position).not.toBeNull();
    const closed = closePaperPosition({
      position: opened.position!, markPrice: "102.0",
      accountCashBalance: opened.accountCashBalanceAfter!,
      realizedDailyLoss: "0", feeBps: account.feeBps, slippageBps: account.slippageBps,
      now: now + 60_000,
    });
    expect(closed.position.status).toBe("closed");
    expect(Number(closed.position.netPnl)).toBeGreaterThan(0);
    expect(closed.executionEligible).toBe(false);
    expect(closed.exchangeOrderSent).toBe(false);
  });
});
