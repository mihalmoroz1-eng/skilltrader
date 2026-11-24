import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import OfflineAIUnavailable from "./OfflineAIUnavailable";

const scenario = {
  symbol: "BTCUSD",
  timeframe: "1ч",
  side: "long",
  unit: "BTC",
  currentPrice: 100,
  entry: 99,
  stop: 95,
  target: 110,
  size: 0.1,
  trials: 10_000,
  outcomes: { target: 0.4, stop: 0.3, other: 0.3 },
} as const;

describe("OfflineAIUnavailable", () => {
  it("labels the local synthetic scenario and makes clear no backend request is sent", () => {
    const html = renderToStaticMarkup(
      createElement(OfflineAIUnavailable, { scenario, simulationReady: true })
    );

    expect(html).toContain('id="skill-trader-ai"');
    expect(html).toContain('data-offline-demo="true"');
    expect(html).toContain("Учебный сценарий BTCUSD рассчитывается локально.");
    expect(html).toContain("AI-пояснения отключены в этой офлайн-демо APK.");
    expect(html).toContain("Запросы к серверу не отправляются.");
    expect(html).toContain("только синтетические данные");
    expect(html).toContain("реальных котировок и торговых операций нет");
  });
});
