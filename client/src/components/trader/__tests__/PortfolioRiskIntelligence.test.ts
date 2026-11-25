import { describe, expect, it } from "vitest";
import { calculatePortfolioRisk } from "../PortfolioRiskIntelligence";

describe("Portfolio Risk Intelligence presentation diagnostics", () => {
  const exposure = [
    { symbol: "BTCUSDT", grossNotional: "600", netNotional: "600", weightPct: 60 },
    { symbol: "ETHUSDT", grossNotional: "400", netNotional: "400", weightPct: 40 },
  ];
  it("weights absolute correlation by the two held asset shares and flags strong pairs", () => {
    const result = calculatePortfolioRisk([
      { symbolA: "BTCUSDT", symbolB: "ETHUSDT", correlation: 0.95, observations: 50, status: "ready" },
    ], exposure);
    expect(result.assessment).toBe("high");
    expect(result.coveragePct).toBe(100);
    expect(result.weightedAbsoluteCorrelationPct).toBe(95);
    expect(result.highPairs).toHaveLength(1);
    expect(result.highPairs[0].level).toBe("very_high");
  });
  it("uses absolute correlation for strongly negative relationships", () => {
    const result = calculatePortfolioRisk([
      { symbolA: "BTCUSDT", symbolB: "ETHUSDT", correlation: -0.85, observations: 40, status: "ready" },
    ], exposure);
    expect(result.highPairs[0].correlation).toBe(-0.85);
    expect(result.highPairs[0].level).toBe("high");
  });
  it("does not treat missing or non-ready pairs as zero correlation", () => {
    const result = calculatePortfolioRisk([
      { symbolA: "BTCUSDT", symbolB: "ETHUSDT", correlation: null, observations: 12, status: "insufficient_history" },
    ], exposure);
    expect(result.assessment).toBe("insufficient_data");
    expect(result.coveragePct).toBe(0);
    expect(result.weightedAbsoluteCorrelationPct).toBeNull();
  });
  it("requires at least two open exposure symbols", () => {
    const result = calculatePortfolioRisk([], [exposure[0]]);
    expect(result.assessment).toBe("insufficient_data");
    expect(result.totalPairs).toBe(0);
  });
});
