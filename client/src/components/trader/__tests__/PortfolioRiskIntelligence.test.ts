import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PortfolioRiskIntelligence from "../PortfolioRiskIntelligence";

const readyRisk = {
  assessment: "high" as const,
  eligiblePairs: 1,
  totalHeldPairs: 1,
  coveragePct: 100,
  weightedAbsoluteCorrelationPct: 95,
  correlatedPairs: [{
    symbolA: "BTCUSDT", symbolB: "ETHUSDT", correlation: -0.95,
    observations: 48, exposurePairWeightPct: 24, level: "very_high" as const,
  }],
};

describe("Portfolio Risk Intelligence presentation", () => {
  it("renders the server-provided assessment and signed pair coefficient", () => {
    const html = renderToStaticMarkup(createElement(PortfolioRiskIntelligence, { risk: readyRisk }));
    expect(html).toContain("Высокая взаимосвязанность");
    expect(html).toContain("BTCUSDT / ETHUSDT");
    expect(html).toContain("-0.95");
    expect(html).toContain("48 наблюдений");
    expect(html).toContain("95.0%");
  });
  it("renders unavailable server diagnostics without inventing a zero value", () => {
    const html = renderToStaticMarkup(createElement(PortfolioRiskIntelligence, { risk: {
      assessment: "insufficient_data", eligiblePairs: 0, totalHeldPairs: 1,
      coveragePct: 0, weightedAbsoluteCorrelationPct: null, correlatedPairs: [],
    } }));
    expect(html).toContain("Недостаточно данных");
    expect(html).toContain("0/1");
    expect(html).toContain("Нет готовых пар");
    expect(html).toContain(">—</strong>");
  });
});
