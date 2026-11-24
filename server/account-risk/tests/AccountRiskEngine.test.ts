import { describe, expect, it } from "vitest";
import { evaluateAccountRisk } from "../core/AccountRiskEngine";
const NOW = 1_800_000_000_000;
function makeInput(overrides: { account?: Record<string, unknown>; candidate?: Record<string, unknown> } = {}) {
  const base = {
    account: { equity: "10000", realizedDailyLoss: "100", currentOpenNotional: "1000", openPositions: 1, maxOpenPositions: 5, riskPerTradeBps: 100, maxDailyLossBps: 300, maxGrossExposureBps: 5000, snapshotAt: NOW - 1_000 },
    candidate: { direction: "LONG" as const, entryPrice: "100", stopPrice: "98", contractMultiplier: "1", quantityStep: "0.001", minimumQuantity: "0.001", roundTripCostBps: 20 },
    evaluatedAt: NOW,
  };
  return { ...base, account: { ...base.account, ...overrides.account }, candidate: { ...base.candidate, ...overrides.candidate } };
}
describe("AccountRiskEngine", () => {
  it("calculates fixed-point quantity for PAPER review only", () => {
    const result = evaluateAccountRisk(makeInput());
    expect(result.status).toBe("approved_for_paper_review");
    expect(result.sizing.quantity).not.toBeNull();
    expect(result.executionEligible).toBe(false);
  });
  it("rejects stale account snapshots and suppresses sizing", () => {
    const result = evaluateAccountRisk(makeInput({ account: { snapshotAt: NOW - 31_000 } }));
    expect(result.status).toBe("rejected");
    expect(result.sizing.quantity).toBeNull();
    expect(result.checks[0].state).toBe("failed");
  });
  it("rejects an exhausted daily loss budget", () => {
    const result = evaluateAccountRisk(makeInput({ account: { realizedDailyLoss: "300" } }));
    expect(result.status).toBe("rejected");
    expect(result.sizing.quantity).toBeNull();
  });
  it("rejects when the open-position limit is reached", () => {
    const result = evaluateAccountRisk(makeInput({ account: { openPositions: 5 } }));
    expect(result.status).toBe("rejected");
  });
  it("rejects a LONG stop on the wrong side of entry", () => {
    expect(() => evaluateAccountRisk(makeInput({ candidate: { stopPrice: "101" } }))).toThrow();
  });
  it("supports SHORT candidates with a stop above entry", () => {
    const result = evaluateAccountRisk(makeInput({ candidate: { direction: "SHORT", stopPrice: "102" } }));
    expect(result.status).toBe("approved_for_paper_review");
  });
  it("rejects when exposure cannot satisfy the minimum quantity", () => {
    const result = evaluateAccountRisk(makeInput({ account: { currentOpenNotional: "500000" } }));
    expect(result.status).toBe("rejected");
    expect(result.sizing.quantity).toBeNull();
  });
  it("rejects future timestamps and malformed decimal values", () => {
    expect(() => evaluateAccountRisk(makeInput({ account: { snapshotAt: NOW + 1 } }))).toThrow();
    expect(() => evaluateAccountRisk(makeInput({ account: { equity: "1e6" } }))).toThrow();
  });
});
