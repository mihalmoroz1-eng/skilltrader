import { useMemo } from "react";
import "./PortfolioCorrelationMatrix.css";

type Correlation = {
  symbolA: string;
  symbolB: string;
  correlation: number | null;
  observations: number;
  status: string;
};

type Props = { correlations: Correlation[] };

function statusLabel(status: string): string {
  if (status === "insufficient_history") return "Недостаточно наблюдений";
  if (status === "zero_variance") return "Нулевая вариация";
  return "Расчёт недоступен";
}

export default function PortfolioCorrelationMatrix({ correlations }: Props) {
  const matrix = useMemo(() => {
    const symbols = [...new Set(correlations.flatMap(pair => [pair.symbolA, pair.symbolB]))].sort();
    const pairs = new Map<string, Correlation>();
    for (const pair of correlations) {
      const key = [pair.symbolA, pair.symbolB].sort().join("::");
      pairs.set(key, pair);
    }
    return { symbols, pairs };
  }, [correlations]);

  if (matrix.symbols.length === 0) {
    return <section className="portfolio-correlation-matrix"><p>Нет пар для построения матрицы.</p></section>;
  }

  return (
    <section className="portfolio-correlation-matrix" aria-labelledby="portfolio-correlation-matrix-title">
      <header>
        <div>
          <span className="portfolio-3d-eyebrow">PAIRWISE RETURN ANALYSIS</span>
          <h3 id="portfolio-correlation-matrix-title">Матрица корреляций</h3>
          <p>Симметричная матрица по готовым серверным расчётам Pearson. Диагональ не оценивается.</p>
        </div>
        <div className="pcm-legend" aria-label="Легенда корреляции">
          <span><i className="pcm-positive" /> Положительная</span>
          <span><i className="pcm-negative" /> Отрицательная</span>
          <span><i className="pcm-missing" /> Нет расчёта</span>
        </div>
      </header>
      <div className="pcm-scroll">
        <table>
          <caption>Корреляция доходностей между выбранными символами</caption>
          <thead>
            <tr><th scope="col">Актив</th>{matrix.symbols.map(symbol => <th scope="col" key={symbol}>{symbol}</th>)}</tr>
          </thead>
          <tbody>
            {matrix.symbols.map(rowSymbol => (
              <tr key={rowSymbol}>
                <th scope="row">{rowSymbol}</th>
                {matrix.symbols.map(columnSymbol => {
                  if (rowSymbol === columnSymbol) return <td key={columnSymbol} className="pcm-diagonal" aria-label="Диагональ не отображается">—</td>;
                  const pair = matrix.pairs.get([rowSymbol, columnSymbol].sort().join("::"));
                  if (!pair || pair.status !== "ready" || pair.correlation == null || !Number.isFinite(pair.correlation)) {
                    const reason = pair ? statusLabel(pair.status) : "Пара отсутствует в результате";
                    return <td key={columnSymbol} className="pcm-unavailable" title={reason} aria-label={reason}>—</td>;
                  }
                  const value = pair.correlation;
                  const opacity = 0.12 + Math.abs(value) * 0.38;
                  const backgroundColor = value >= 0
                    ? `rgba(77, 216, 176, ${opacity})`
                    : `rgba(255, 139, 155, ${opacity})`;
                  return <td key={columnSymbol} className={value >= 0 ? "pcm-value positive" : "pcm-value negative"}
                    style={{ backgroundColor }}
                    title={`Pearson ${value.toFixed(3)} · ${pair.observations} наблюдений`}
                    aria-label={`${rowSymbol} и ${columnSymbol}: ${value.toFixed(3)}, ${pair.observations} наблюдений`}>
                    <strong>{value.toFixed(2)}</strong><small>{pair.observations} obs.</small>
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pcm-note">Цвет показывает знак, насыщенность — абсолютную величину корреляции. Значения ниже серверного порога качества не подменяются оценками.</p>
    </section>
  );
}
