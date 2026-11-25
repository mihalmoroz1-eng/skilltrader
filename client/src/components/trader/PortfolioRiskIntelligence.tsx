import { useMemo } from "react";
import "./PortfolioRiskIntelligence.css";

type Correlation = { symbolA: string; symbolB: string; correlation: number | null; observations: number; status: string };
type Exposure = { symbol: string; grossNotional: string; netNotional: string; weightPct: number };
type Props = { correlations: Correlation[]; exposure: Exposure[] };

type RiskPair = { symbolA: string; symbolB: string; correlation: number; observations: number; pairWeightPct: number; level: "high" | "very_high" };
export function calculatePortfolioRisk(correlations: Correlation[], exposure: Exposure[]) {
  const weights = new Map(exposure.map(item => [item.symbol, item.weightPct / 100]));
  const symbols = [...weights.keys()].sort();
  const totalPairs = symbols.length * (symbols.length - 1) / 2;
  const pairMap = new Map(correlations.map(pair => [[pair.symbolA, pair.symbolB].sort().join("::"), pair] as const));
  let eligiblePairs = 0, numerator = 0, denominator = 0;
  const highPairs: RiskPair[] = [];
  for (let i = 0; i < symbols.length; i++) for (let j = i + 1; j < symbols.length; j++) {
    const symbolA = symbols[i], symbolB = symbols[j];
    const pair = pairMap.get([symbolA, symbolB].sort().join("::"));
    if (!pair || pair.status !== "ready" || pair.correlation == null || !Number.isFinite(pair.correlation)) continue;
    eligiblePairs++;
    const pairWeight = weights.get(symbolA)! * weights.get(symbolB)!;
    numerator += Math.abs(pair.correlation) * pairWeight;
    denominator += pairWeight;
    const absolute = Math.abs(pair.correlation);
    if (absolute >= 0.8) highPairs.push({
      symbolA, symbolB, correlation: pair.correlation, observations: pair.observations,
      pairWeightPct: pairWeight * 100, level: absolute >= 0.9 ? "very_high" : "high",
    });
  }
  const coveragePct = totalPairs ? eligiblePairs / totalPairs * 100 : null;
  const weightedAbsoluteCorrelationPct = denominator ? numerator / denominator * 100 : null;
  const assessment = coveragePct == null || coveragePct < 80 || weightedAbsoluteCorrelationPct == null
    ? "insufficient_data" : weightedAbsoluteCorrelationPct >= 70 ? "high"
      : weightedAbsoluteCorrelationPct >= 40 ? "moderate" : "low";
  highPairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return { assessment, eligiblePairs, totalPairs, coveragePct, weightedAbsoluteCorrelationPct, highPairs };
}

function percent(value: number | null) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1) + "%"; }

export default function PortfolioRiskIntelligence({ correlations, exposure }: Props) {
  const risk = useMemo(() => calculatePortfolioRisk(correlations, exposure), [correlations, exposure]);
  const labels: Record<"insufficient_data" | "low" | "moderate" | "high", string> = { insufficient_data: "Недостаточно данных", low: "Низкая взаимосвязанность", moderate: "Умеренная взаимосвязанность", high: "Высокая взаимосвязанность" };
  return (
    <section className="portfolio-risk-intelligence" aria-labelledby="portfolio-risk-title">
      <header><div><span className="portfolio-3d-eyebrow">PORTFOLIO RISK INTELLIGENCE</span><h3 id="portfolio-risk-title">Взаимосвязанность открытых позиций</h3>
        <p>Оценка только тех пар, где оба актива присутствуют в текущей PAPER-экспозиции.</p></div>
        <span className={"pri-assessment " + risk.assessment}>{labels[risk.assessment]}</span></header>
      <div className="pri-metrics">
        <div><span>Средняя |корреляция| с весами</span><strong>{percent(risk.weightedAbsoluteCorrelationPct)}</strong></div>
        <div><span>Покрытие пар</span><strong>{risk.eligiblePairs}/{risk.totalPairs}</strong></div>
        <div><span>Данные по парам</span><strong>{percent(risk.coveragePct)}</strong></div>
      </div>
      {risk.highPairs.length ? <div className="pri-pairs">
        <strong>Пары с корреляцией от 0.80 по модулю</strong>
        {risk.highPairs.map(pair => <div className="pri-pair" key={pair.symbolA + pair.symbolB}>
          <span>{pair.symbolA} / {pair.symbolB}</span><b>{pair.correlation > 0 ? "+" : ""}{pair.correlation.toFixed(2)}</b>
          <small>{pair.level === "very_high" ? "Очень высокая" : "Высокая"} · {pair.observations} наблюдений</small>
        </div>)}
      </div> : <p className="pri-empty">{risk.totalPairs === 0 ? "Нет двух и более открытых активов для парного анализа." : "Нет готовых пар с корреляцией ≥ 0.80 по модулю."}</p>}
      <p className="pri-foot">Показатель описывает историческую совместную динамику доходностей, а не вероятность убытка. Он не учитывает волатильность, ликвидацию, плечо или изменение корреляций. Это предупреждающая аналитика, не команда на изменение позиций.</p>
    </section>
  );
}
