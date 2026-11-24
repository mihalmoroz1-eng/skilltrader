import { describe, expect, it, vi } from "vitest";
import type { FuturesMarketProvider, FuturesRawSnapshot } from "../../futures-intelligence/core/FuturesLiquidityTypes";
import type { PaperInstrumentRulesProvider } from "../providers/BinanceUsdMInstrumentRulesProvider";
import type { PaperExecutionStore } from "../core/PaperExecutionService";
import { PaperExecutionService } from "../core/PaperExecutionService";
import type { PaperAccountRecord } from "../core/DrizzlePaperExecutionStore";
import type { PaperPosition, PaperSignalRecord } from "../core/PaperExecutionEngine";

const now = Date.UTC(2027, 0, 15, 12);
const account: PaperAccountRecord = {
  userOpenId: "user-1", currency: "USDT", startingBalance: "10000", cashBalance: "10000",
  realizedDailyLoss: "0", dailyLossDate: "2027-01-15",
  riskPerTradeBps: 50, maxDailyLossBps: 200, maxGrossExposureBps: 10000,
  maxOpenPositions: 3, feeBps: 5, slippageBps: 5,
};
const signal: PaperSignalRecord = {
  userOpenId: "user-1", signalId: "a".repeat(24), marketRunId: "market-run",
  validationDigest: "b".repeat(64), marketEvidenceDigest: "c".repeat(64),
  symbol: "BTCUSDT", interval: "15m", direction: "LONG",
  thesisCodes: ["close_above_ema20"], createdAt: now - 60_000, status: "accepted",
};
const rules = { symbol: "BTCUSDT", contractMultiplier: "1", tickSize: "0.1", quantityStep: "0.001", minimumQuantity: "0.001" };
const snapshot: FuturesRawSnapshot = {
  symbol: "BTCUSDT", source: "binance-usdm-futures", fetchedAt: now - 500,
  orderBook: { lastUpdateId: 1, bids: [{ price: "100", quantity: "5" }], asks: [{ price: "100.1", quantity: "5" }] },
  markPrice: "100.05", indexPrice: "100", fundingRate: "0.0001", nextFundingTime: now + 1000, openInterest: "1000",
};

function makeHarness(options: { account?: PaperAccountRecord; signal?: PaperSignalRecord; positions?: PaperPosition[]; marketSnapshot?: FuturesRawSnapshot } = {}) {
  let currentAccount = { ...(options.account ?? account) };
  let currentSignal = { ...(options.signal ?? signal) };
  let positions = [...(options.positions ?? [])];
  const store = {
    createAccount: vi.fn(async () => currentAccount),
    getAccount: vi.fn(async () => currentAccount),
    getSignal: vi.fn(async () => currentSignal),
    recordSignalReview: vi.fn(async () => undefined),
    setSignalStatus: vi.fn(async (_user: string, _id: string, status: "accepted" | "dismissed") => {
      currentSignal = { ...currentSignal, status };
      return currentSignal;
    }),
    getOpenPositions: vi.fn(async () => positions.filter(position => position.status === "open")),
    getPosition: vi.fn(async (_user: string, id: number) => positions.find(position => position.id === id) ?? null),
    listPositions: vi.fn(async () => positions),
    openPositionAtomic: vi.fn(async (input: Parameters<PaperExecutionStore["openPositionAtomic"]>[0]) => {
      currentAccount = { ...currentAccount, cashBalance: input.newCashBalance, realizedDailyLoss: input.newDailyLoss, dailyLossDate: input.dailyLossDate };
      currentSignal = { ...currentSignal, status: "consumed" };
      const position = { ...input.position, id: 1 };
      positions.push(position);
      return position;
    }),
    closePositionAtomic: vi.fn(async (input: Parameters<PaperExecutionStore["closePositionAtomic"]>[0]) => {
      currentAccount = { ...currentAccount, cashBalance: input.newCashBalance, realizedDailyLoss: input.newDailyLoss, dailyLossDate: input.dailyLossDate };
      positions = positions.map(position => position.id === input.positionId ? input.closedPosition : position);
      return input.closedPosition;
    }),
    getPortfolio: vi.fn(async () => ({ account: currentAccount, positions, signals: [currentSignal] })),
  } as unknown as PaperExecutionStore;
  const rulesProvider: PaperInstrumentRulesProvider = { getRules: vi.fn(async () => rules) };
  const futuresProvider: FuturesMarketProvider = { id: "binance-usdm-futures", fetchSnapshot: vi.fn(async () => options.marketSnapshot ?? snapshot) };
  const service = new PaperExecutionService(store, rulesProvider, futuresProvider, () => now);
  return { service, store, rulesProvider, futuresProvider, getAccount: () => currentAccount, getSignal: () => currentSignal, getPositions: () => positions };
}

describe("PAPER execution service", () => {
  it("opens only a fresh accepted server signal and consumes it atomically", async () => {
    const h = makeHarness();
    const result = await h.service.openPosition("user-1", {
      signalId: signal.signalId, stopPrice: "98", targetPrice: "104",
    });
    expect(result.status).toBe("opened");
    expect(result.position?.entryPrice).toBe("100.2");
    expect(h.getSignal().status).toBe("consumed");
    expect(h.store.openPositionAtomic).toHaveBeenCalledOnce();
    expect(result.exchangeOrderSent).toBe(false);
  });

  it("rejects expired signals before querying market or instrument providers", async () => {
    const expired = { ...signal, createdAt: now - 5 * 60_000 - 1 };
    const h = makeHarness({ signal: expired });
    await expect(h.service.openPosition("user-1", {
      signalId: signal.signalId, stopPrice: "98", targetPrice: "104",
    })).rejects.toThrow(/approval expired/);
    expect(h.rulesProvider.getRules).not.toHaveBeenCalled();
    expect(h.futuresProvider.fetchSnapshot).not.toHaveBeenCalled();
  });

  it("resets only the new UTC day's realized loss when opening after rollover", async () => {
    const previousDay = { ...account, dailyLossDate: "2027-01-14", realizedDailyLoss: "75" };
    const h = makeHarness({ account: previousDay });
    await h.service.openPosition("user-1", {
      signalId: signal.signalId, stopPrice: "98", targetPrice: "104",
    });
    const atomicInput = vi.mocked(h.store.openPositionAtomic).mock.calls[0][0];
    expect(atomicInput.expectedDailyLoss).toBe("75");
    expect(atomicInput.newDailyLoss).toBe("0");
    expect(atomicInput.dailyLossDate).toBe("2027-01-15");
  });

  it("calculates equity from reserved entry notional plus unrealized PnL without double counting mark movement", async () => {
    const position: PaperPosition = {
      id: 11, userOpenId: "user-1", signalId: "e".repeat(24), marketRunId: "run",
      symbol: "BTCUSDT", interval: "15m", side: "LONG", quantity: "10", notional: "1000",
      entryPrice: "100", stopPrice: "98", targetPrice: "120", contractMultiplier: "1",
      tickSize: "0.1", entryFee: "0.5", status: "open", openedAt: now - 60_000, feesPaid: "0.5",
    };
    const markedSnapshot = { ...snapshot, markPrice: "110.0" };
    const h = makeHarness({
      account: { ...account, cashBalance: "8999.5" },
      positions: [position],
      marketSnapshot: markedSnapshot,
    });
    const portfolio = await h.service.getPortfolio("user-1");
    expect(portfolio.currentOpenNotional).toBe("1100");
    expect(portfolio.equity).toBe("10097.9505");
    expect(portfolio.markToMarketAvailable).toBe(true);
  });

  it("closes a virtual position at a public mark and records the ledger update", async () => {
    const position: PaperPosition = {
      id: 9, userOpenId: "user-1", signalId: "d".repeat(24), marketRunId: "run",
      symbol: "BTCUSDT", interval: "15m", side: "LONG", quantity: "10", notional: "1000",
      entryPrice: "100", stopPrice: "98", targetPrice: "104", contractMultiplier: "1",
      tickSize: "0.1", entryFee: "0.5", status: "open", openedAt: now - 60_000, feesPaid: "0.5",
    };
    const h = makeHarness({ account: { ...account, cashBalance: "8999.5" }, positions: [position] });
    const result = await h.service.closePosition("user-1", 9);
    expect(result.position.status).toBe("closed");
    expect(result.position.netPnl).toBeDefined();
    expect(h.store.closePositionAtomic).toHaveBeenCalledOnce();
    expect(result.exchangeOrderSent).toBe(false);
  });
});
