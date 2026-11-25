import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PortfolioRiskIntelligence from "../PortfolioRiskIntelligence";

const readyForecast = {
  status: "ready" as const, method: "historical_covariance_normal_approximation" as const,
  annualizedPortfolioVolatilityPct: 42.5, oneDay95VaR: "12.34", oneDay95VaRPctOfEquity: 1.23,
  fiveDay95VaR: "27.58", fiveDay95VaRPctOfEquity: 2.76, observations: 39,
  annualizationPeriods: 8766, symbols: [{ symbol: "BTCUSDT", annualizedVolatilityPct: 40, observations: 39 }],
};

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
    const html = renderToStaticMarkup(createElement(PortfolioRiskIntelligence, { risk: readyRisk, forecast: readyForecast }));
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
    }, forecast: { ...readyForecast, status: "insufficient_data" as const, annualizedPortfolioVolatilityPct: null, oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null, fiveDay95VaRPctOfEquity: null, observations: 0, symbols: [] } }));
    expect(html).toContain("Недостаточно данных");
    expect(html).toContain("0/1");
    expect(html).toContain("Нет готовых пар");
    expect(html).toContain(">—</strong>");
  });
});
