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
type Props = { risk: RiskIntelligence };

function percent(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1) + "%";
}

export default function PortfolioRiskIntelligence({ risk }: Props) {
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
      <p className="pri-foot">Показатель описывает историческую совместную динамику доходностей, а не вероятность убытка. Он не учитывает волатильность, ликвидацию, плечо или изменение корреляций. Это предупреждающая аналитика, не команда на изменение позиций.</p>
    </section>
  );
}
