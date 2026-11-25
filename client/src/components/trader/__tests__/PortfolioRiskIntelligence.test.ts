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

const readyDrawdown = {
  status: "ready" as const, method: "historical_static_current_exposure" as const, observations: 39,
  maxDrawdownPct: 12.5, currentDrawdownPct: 2.5, maxDrawdownDurationObservations: 9,
  currentDrawdownDurationObservations: 2, maxDrawdownRecovered: true,
  episodeCount: 2, recoveredEpisodeCount: 1, unrecoveredEpisodeCount: 1,
  averageRecoveryObservations: 9, longestEpisodeObservations: 12,
  curve: [{ time: 1, drawdownPct: 0 }, { time: 2, drawdownPct: 12.5 }, { time: 3, drawdownPct: 2.5 }],
  recentEpisodes: [{ peakTime: 1, troughTime: 2, recoveryTime: 3, depthPct: 12.5, durationObservations: 9, recovered: true }],
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
    const html = renderToStaticMarkup(createElement(PortfolioRiskIntelligence, { risk: readyRisk, forecast: readyForecast, drawdown: readyDrawdown }));
    expect(html).toContain("Высокая взаимосвязанность");
    expect(html).toContain("BTCUSDT / ETHUSDT");
    expect(html).toContain("-0.95");
    expect(html).toContain("48 наблюдений");
    expect(html).toContain("95.0%");
    expect(html).toContain("Историческая просадка");
    expect(html).toContain("12.5%");
    expect(html).toContain("Восстановлена до прежнего пика");
    expect(html).toContain("История просадки");
    expect(html).toContain("Среднее восстановление");
    expect(html).toContain("Сравнение периодов просадки");
    expect(html).toContain("9.0 баров");
  });
  it("renders unavailable server diagnostics without inventing a zero value", () => {
    const html = renderToStaticMarkup(createElement(PortfolioRiskIntelligence, { risk: {
      assessment: "insufficient_data", eligiblePairs: 0, totalHeldPairs: 1,
      coveragePct: 0, weightedAbsoluteCorrelationPct: null, correlatedPairs: [],
    }, drawdown: { ...readyDrawdown, status: "insufficient_data" as const, maxDrawdownPct: null, currentDrawdownPct: null, maxDrawdownDurationObservations: null, currentDrawdownDurationObservations: null, maxDrawdownRecovered: null, episodeCount: 0, recoveredEpisodeCount: 0, unrecoveredEpisodeCount: 0, averageRecoveryObservations: null, longestEpisodeObservations: null, curve: [], recentEpisodes: [] }, forecast: { ...readyForecast, status: "insufficient_data" as const, annualizedPortfolioVolatilityPct: null, oneDay95VaR: null, oneDay95VaRPctOfEquity: null, fiveDay95VaR: null, fiveDay95VaRPctOfEquity: null, observations: 0, symbols: [] } }));
    expect(html).toContain("Недостаточно данных");
    expect(html).toContain("0/1");
    expect(html).toContain("Нет готовых пар");
    expect(html).toContain(">—</strong>");
  });
});
