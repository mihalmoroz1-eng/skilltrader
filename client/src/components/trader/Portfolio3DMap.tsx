import { useMemo, useState } from "react";
import "./Portfolio3DMap.css";

type Correlation = {
  symbolA: string;
  symbolB: string;
  correlation: number | null;
  observations: number;
  status: string;
};

type Exposure = {
  symbol: string;
  grossNotional: string;
  netNotional: string;
  weightPct: number;
};

type Props = {
  correlations: Correlation[];
  exposure: Exposure[];
};

const WIDTH = 760;
const HEIGHT = 330;
const CENTER_X = 380;
const CENTER_Y = 158;

function money(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";
}

export default function Portfolio3DMap({ correlations, exposure }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const graph = useMemo(() => {
    const symbols = [...new Set([
      ...correlations.flatMap(pair => [pair.symbolA, pair.symbolB]),
      ...exposure.map(item => item.symbol),
    ])].sort();
    const nodes = symbols.map((symbol, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(symbols.length, 1) - Math.PI / 2;
      const radius = symbols.length <= 2 ? 118 : 124;
      const item = exposure.find(value => value.symbol === symbol);
      const weight = item?.weightPct ?? 0;
      return {
        symbol,
        x: CENTER_X + Math.cos(angle) * radius,
        y: CENTER_Y + Math.sin(angle) * radius * 0.64,
        weight,
        gross: item?.grossNotional ?? null,
        net: item?.netNotional ?? null,
        size: 12 + Math.min(18, Math.max(0, weight) * 0.18),
      };
    });
    const bySymbol = new Map(nodes.map(node => [node.symbol, node]));
    const edges = correlations
      .filter(pair => pair.status === "ready" && pair.correlation !== null && Number.isFinite(pair.correlation))
      .map(pair => ({
        ...pair,
        from: bySymbol.get(pair.symbolA),
        to: bySymbol.get(pair.symbolB),
      }))
      .filter(edge => edge.from && edge.to);
    return { nodes, edges };
  }, [correlations, exposure]);

  const selectedNode = graph.nodes.find(node => node.symbol === selected) ?? null;
  const selectedPairs = selected
    ? graph.edges.filter(edge => edge.symbolA === selected || edge.symbolB === selected)
    : [];

  return (
    <section className="portfolio-3d-map" aria-labelledby="portfolio-3d-map-title">
      <div className="portfolio-3d-map-head">
        <div>
          <span className="portfolio-3d-eyebrow">SPATIAL PORTFOLIO VIEW</span>
          <h3 id="portfolio-3d-map-title">3D-карта активов и корреляций</h3>
          <p>Связи показывают только пары с готовым расчётом Pearson.</p>
        </div>
        <span className="portfolio-3d-map-count">{graph.nodes.length} активов · {graph.edges.length} связей</span>
      </div>
      {graph.nodes.length === 0 ? (
        <p className="portfolio-3d-empty">Нет активов для построения карты. Выполните расчёт корреляций.</p>
      ) : (
        <div className="portfolio-3d-stage">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Схема активов и рассчитанных корреляций">
            <defs>
              <linearGradient id="portfolioPlane" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#283c73" stopOpacity=".65" />
                <stop offset="100%" stopColor="#10182d" stopOpacity=".15" />
              </linearGradient>
              <filter id="portfolioGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <polygon points="380,18 710,158 380,300 50,158" fill="url(#portfolioPlane)" stroke="#6478b5" strokeOpacity=".3" />
            {Array.from({ length: 7 }, (_, index) => (
              <line key={`grid-x-${index}`} x1={90 + index * 48} y1={158 - index * 20.3} x2={380 + index * 48} y2={282 - index * 20.3} stroke="#7d91c5" strokeOpacity=".13" />
            ))}
            {Array.from({ length: 7 }, (_, index) => (
              <line key={`grid-y-${index}`} x1={90 + index * 48} y1={158 + index * 20.3} x2={380 + index * 48} y2={34 + index * 20.3} stroke="#7d91c5" strokeOpacity=".13" />
            ))}
            {graph.edges.map(edge => {
              const value = edge.correlation ?? 0;
              const positive = value >= 0;
              return (
                <g key={edge.symbolA + edge.symbolB}>
                  <line x1={edge.from!.x} y1={edge.from!.y} x2={edge.to!.x} y2={edge.to!.y}
                    stroke={positive ? "#4dd8b0" : "#ff8b9b"} strokeWidth={1.2 + Math.abs(value) * 3.2}
                    strokeOpacity={0.25 + Math.abs(value) * 0.65} strokeDasharray={Math.abs(value) < 0.25 ? "5 5" : undefined} />
                  <text x={(edge.from!.x + edge.to!.x) / 2} y={(edge.from!.y + edge.to!.y) / 2 - 5}
                    className="portfolio-3d-edge-label">{value.toFixed(2)}</text>
                </g>
              );
            })}
            {graph.nodes.map(node => (
              <g key={node.symbol} className={`portfolio-3d-node ${selected === node.symbol ? "is-selected" : ""}`}
                role="button" tabIndex={0} aria-label={`${node.symbol}, доля ${node.weight.toFixed(2)} процентов`}
                aria-pressed={selected === node.symbol}
                onClick={() => setSelected(current => current === node.symbol ? null : node.symbol)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(current => current === node.symbol ? null : node.symbol);
                  }
                }}>
                <ellipse cx={node.x + 5} cy={node.y + node.size + 9} rx={node.size * 1.5} ry="6" fill="#030712" opacity=".55" />
                <circle cx={node.x} cy={node.y} r={node.size + 5} fill="#6175d9" opacity=".12" />
                <circle cx={node.x} cy={node.y} r={node.size} fill="#18264b" stroke={selected === node.symbol ? "#fff" : "#8ea4ff"} strokeWidth={selected === node.symbol ? 2.5 : 1.4} filter="url(#portfolioGlow)" />
                <circle cx={node.x - node.size * .28} cy={node.y - node.size * .3} r={node.size * .23} fill="#a5b4fc" opacity=".8" />
                <text x={node.x} y={node.y + node.size + 23} textAnchor="middle" className="portfolio-3d-node-label">{node.symbol}</text>
              </g>
            ))}
          </svg>
          <div className="portfolio-3d-legend"><span><i className="positive" /> Положительная корреляция</span><span><i className="negative" /> Отрицательная корреляция</span><span>Толщина линии = сила связи</span></div>
        </div>
      )}
      {selectedNode && (
        <div className="portfolio-3d-detail" aria-live="polite">
          <div><strong>{selectedNode.symbol}</strong><span>Доля портфеля: {selectedNode.weight.toFixed(2)}%</span></div>
          <div><span>Gross: {selectedNode.gross == null ? "нет открытой позиции" : money(selectedNode.gross)}</span><span>Net: {selectedNode.net == null ? "—" : money(selectedNode.net)}</span></div>
          <div className="portfolio-3d-pairs">
            {selectedPairs.length === 0 ? "Нет готовых корреляционных пар." : selectedPairs.map(pair => (
              <span key={pair.symbolA + pair.symbolB}>{pair.symbolA}/{pair.symbolB}: {pair.correlation!.toFixed(3)} · {pair.observations} наблюдений</span>
            ))}
          </div>
        </div>
      )}
      <p className="portfolio-3d-footnote">Размер узла отражает только известную долю PAPER-экспозиции. Если открытых позиций нет, узлы показывают только состав исследуемых символов. Схема не является торговым сигналом.</p>
    </section>
  );
}
