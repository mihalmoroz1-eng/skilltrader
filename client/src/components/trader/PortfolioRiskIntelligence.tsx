import React from "react";
import "./PortfolioRiskIntelligence.css";

type RiskIntelligence = {
  assessment: "insufficient_data" | "low" | "moderate" | "high";
  eligiblePairs: number;
  totalHeldPairs: number;
  coveragePct: number | null;
  weightedAbsoluteCorrelationPct: number | null;
  correlatedPairs: Array<{
    symbolA: string;
    symbolB: string;
    correlation: number;
    observations: number;
    exposurePairWeightPct: number;
    level: "high" | "very_high";
  }>;
};
type RiskForecast = {
  status: "ready" | "insufficient_data" | "no_exposure" | "stale_marks";
  method: "historical_covariance_normal_approximation";
  annualizedPortfolioVolatilityPct: number | null;
  oneDay95VaR: string | null;
  oneDay95VaRPctOfEquity: number | null;
  fiveDay95VaR: string | null;
  fiveDay95VaRPctOfEquity: number | null;
  observations: number;
  annualizationPeriods: number;
  symbols: Array<{ symbol: string; annualizedVolatilityPct: number | null; observations: number }>;
};
type Props = { risk: RiskIntelligence; forecast: RiskForecast };

function percent(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1) + "%";
}

export default function PortfolioRiskIntelligence({ risk, forecast }: Props) {
  const labels: Record<RiskIntelligence["assessment"], string> = {
    insufficient_data: "Недостаточно данных", low: "Низкая взаимосвязанность",
    moderate: "Умеренная взаимосвязанность", high: "Высокая взаимосвязанность",
  };
  return (
    <section className="portfolio-risk-intelligence" aria-labelledby="portfolio-risk-title">
      <header><div><span className="portfolio-3d-eyebrow">PORTFOLIO RISK INTELLIGENCE</span><h3 id="portfolio-risk-title">Взаимосвязанность открытых позиций</h3>
        <p>Серверный расчёт только по парам активов с открытой PAPER-экспозицией и актуальными mark-price.</p></div>
        <span className={"pri-assessment " + risk.assessment}>{labels[risk.assessment]}</span></header>
      <div className="pri-metrics">
        <div><span>Средняя |корреляция| с весами</span><strong>{percent(risk.weightedAbsoluteCorrelationPct)}</strong></div>
        <div><span>Покрытие пар</span><strong>{risk.eligiblePairs}/{risk.totalHeldPairs}</strong></div>
        <div><span>Данные по парам</span><strong>{percent(risk.coveragePct)}</strong></div>
      </div>
      {risk.correlatedPairs.length ? <div className="pri-pairs">
        <strong>Пары с корреляцией от 0.80 по модулю</strong>
        {risk.correlatedPairs.map(pair => <div className="pri-pair" key={pair.symbolA + pair.symbolB}>
          <span>{pair.symbolA} / {pair.symbolB}</span><b>{pair.correlation > 0 ? "+" : ""}{pair.correlation.toFixed(2)}</b>
          <small>{pair.level === "very_high" ? "Очень высокая" : "Высокая"} · {pair.observations} наблюдений · вес пары {percent(pair.exposurePairWeightPct)}</small>
        </div>)}
      </div> : <p className="pri-empty">{risk.totalHeldPairs === 0
        ? "Нет двух и более позиций с доступной актуальной экспозицией для парного анализа."
        : "Нет готовых пар с корреляцией ≥ 0.80 по модулю."}</p>}
      <div className="pri-forecast">
        <div className="pri-forecast-head"><div><span className="portfolio-3d-eyebrow">PORTFOLIO RISK FORECAST</span><h4>Историческая волатильность и VaR</h4></div>
          <span className={"pri-assessment " + (forecast.status === "ready" ? "low" : "insufficient_data")}>{forecast.status === "ready" ? "Расчёт готов" : forecast.status === "stale_marks" ? "Котировки устарели" : forecast.status === "no_exposure" ? "Нет экспозиции" : "Недостаточно истории"}</span></div>
        {forecast.status === "ready" ? <>
          <div className="pri-metrics pri-forecast-metrics">
            <div><span>Годовая волатильность портфеля</span><strong>{percent(forecast.annualizedPortfolioVolatilityPct)}</strong></div>
            <div><span>95% VaR · 1 день</span><strong>{forecast.oneDay95VaR ?? "—"}</strong><small>{percent(forecast.oneDay95VaRPctOfEquity)} от equity</small></div>
            <div><span>95% VaR · 5 дней</span><strong>{forecast.fiveDay95VaR ?? "—"}</strong><small>{percent(forecast.fiveDay95VaRPctOfEquity)} от equity</small></div>
          </div>
          <div className="pri-pairs"><strong>Годовая волатильность по активам</strong>
            {forecast.symbols.map(item => <div className="pri-pair pri-vol-row" key={item.symbol}><span>{item.symbol}</span><b>{percent(item.annualizedVolatilityPct)}</b><small>{item.observations} последовательных доходностей</small></div>)}
          </div>
          <p className="pri-foot">Общих наблюдений: {forecast.observations}. VaR — статистическая оценка при нормальном приближении и sqrt(time), не максимальный возможный убыток и не гарантия результата.</p>
        </> : <p className="pri-empty">{forecast.status === "stale_marks"
          ? "Оценка скрыта: нет актуальных mark-price. Старые котировки не используются."
          : forecast.status === "no_exposure" ? "Нет открытой PAPER-экспозиции для оценки портфельной волатильности."
            : "Для каждого открытого актива требуется минимум 30 последовательных доходностей и общая синхронная история."}</p>}
      </div>
      <p className="pri-foot">Показатель описывает историческую совместную динамику доходностей, а не вероятность убытка. Он не учитывает волатильность, ликвидацию, плечо или изменение корреляций. Это предупреждающая аналитика, не команда на изменение позиций.</p>
    </section>
  );
}
