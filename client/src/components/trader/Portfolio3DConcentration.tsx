import { useMemo, useState } from "react";
import "./Portfolio3DConcentration.css";

type Exposure = { symbol: string; grossNotional: string; netNotional: string; weightPct: number };
type Props = {
  exposure: Exposure[];
  largestSymbol: string | null;
  largestWeightPct: number | null;
  herfindahlIndex: number | null;
  grossExposure: string | null;
  grossExposureUtilizationBps: number | null;
  grossExposureLimitBps: number | null;
  withinConfiguredGrossExposure: boolean | null;
};
const fmt = (n: number | null, d = 2) => n == null || !Number.isFinite(n) ? "—" : n.toFixed(d);
const money = (s: string | null) => {
  if (s == null) return "—";
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
};

export default function Portfolio3DConcentration(p: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const bars = useMemo(() => {
    const sorted = [...p.exposure].sort((a, b) => b.weightPct - a.weightPct || a.symbol.localeCompare(b.symbol));
    const max = Math.max(1, ...sorted.map(x => x.weightPct));
    const spacing = Math.min(104, 680 / Math.max(1, sorted.length));
    return sorted.map((item, i) => {
      const height = Math.max(3, item.weightPct / max * 112);
      return { ...item, x: 36 + i * spacing, y: 190 - height, height };
    });
  }, [p.exposure]);
  const active = bars.find(x => x.symbol === selected);
  const used = p.grossExposureUtilizationBps == null ? null : p.grossExposureUtilizationBps / 100;
  const limit = p.grossExposureLimitBps == null ? null : p.grossExposureLimitBps / 100;
  const meter = used == null || limit == null || limit <= 0 ? null : Math.max(0, Math.min(100, used / limit * 100));

  return <section className="portfolio-3d-concentration" aria-labelledby="portfolio-3d-concentration-title">
    <div className="portfolio-3d-concentration-head">
      <div><span className="portfolio-3d-eyebrow">CAPITAL DISTRIBUTION</span>
        <h3 id="portfolio-3d-concentration-title">3D-концентрация капитала</h3>
        <p>Высота колонны пропорциональна доле gross-экспозиции в PAPER-портфеле.</p></div>
      <span className="portfolio-3d-map-count">{bars.length} активов</span>
    </div>
    {bars.length === 0 ? <p className="portfolio-3d-empty">Открытых PAPER-позиций нет. Распределение капитала не строится.</p> : <>
      <div className="portfolio-3d-concentration-stage">
        <svg viewBox="0 0 760 245" role="group" aria-label="3D-диаграмма распределения gross-экспозиции">
          <defs><linearGradient id="concFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8294ff"/><stop offset="100%" stopColor="#3949a3"/></linearGradient><linearGradient id="concSide"><stop offset="0%" stopColor="#28377e"/><stop offset="100%" stopColor="#151e4b"/></linearGradient></defs>
          <polygon points="28,190 690,190 738,214 76,214" fill="#101a36" stroke="#6578b8" strokeOpacity=".3"/>
          {bars.map(b => <g key={b.symbol} className="concentration-bar" role="button" tabIndex={0}
            aria-label={`${b.symbol}: доля ${fmt(b.weightPct)} процентов, gross ${b.grossNotional}`}
            aria-pressed={selected === b.symbol}
            onClick={() => setSelected(v => v === b.symbol ? null : b.symbol)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(v => v === b.symbol ? null : b.symbol); } }}>
            <polygon points={`${b.x},${b.y} ${b.x+12},${b.y-8} ${b.x+54},${b.y-8} ${b.x+42},${b.y}`} fill="#b5c0ff"/>
            <polygon points={`${b.x+42},${b.y} ${b.x+54},${b.y-8} ${b.x+54},190 ${b.x+42},198`} fill="url(#concSide)"/>
            <rect x={b.x} y={b.y} width="42" height={b.height} rx="2" fill="url(#concFront)" stroke={selected === b.symbol ? "#fff" : "#a5b4fc"} strokeWidth={selected === b.symbol ? 2.5 : 1}/>
            <text x={b.x+21} y={Math.max(15,b.y-15)} textAnchor="middle" className="concentration-value">{fmt(b.weightPct)}%</text>
            <text x={b.x+21} y="230" textAnchor="middle" className="concentration-symbol">{b.symbol}</text>
          </g>)}
        </svg>
        <p className="portfolio-3d-concentration-caption">Доли внутри текущей gross-экспозиции, не доли всего баланса счёта.</p>
      </div>
      {active && <div className="portfolio-3d-concentration-detail" aria-live="polite"><strong>{active.symbol}</strong><span>Доля: {fmt(active.weightPct)}%</span><span>Gross: {money(active.grossNotional)}</span><span>Net: {money(active.netNotional)}</span></div>}
      <div className="portfolio-3d-concentration-list">{bars.map(b => <button type="button" key={b.symbol} className={selected === b.symbol ? "is-selected" : ""} onClick={() => setSelected(v => v === b.symbol ? null : b.symbol)}><span>{b.symbol}</span><strong>{fmt(b.weightPct)}%</strong></button>)}</div>
    </>}
    <div className="portfolio-3d-concentration-metrics">
      <div><span>Крупнейшая доля</span><strong>{p.largestSymbol ? `${p.largestSymbol} · ${fmt(p.largestWeightPct)}%` : "—"}</strong></div>
      <div><span>Herfindahl index</span><strong>{fmt(p.herfindahlIndex,0)} / 10 000</strong></div>
      <div><span>Gross exposure</span><strong>{money(p.grossExposure)}</strong></div>
    </div>
    <div className="portfolio-3d-utilization">
      <div><span>Использование gross-лимита</span><strong>{used == null || limit == null ? "—" : `${fmt(used)}% / ${fmt(limit)}%`}</strong></div>
      {meter == null ? <p>Нет актуальных mark-price или лимита для расчёта.</p> : <div className="portfolio-3d-util-track" role="meter" aria-label="Использование gross-лимита" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter)}><span style={{width:`${meter}%`}} data-over-limit={p.withinConfiguredGrossExposure === false ? "true" : "false"}/></div>}
      {p.withinConfiguredGrossExposure === false && <p className="portfolio-3d-util-warning">Gross-экспозиция выше настроенного лимита. Это предупреждение аналитики, не изменение риска.</p>}
    </div>
    <p className="portfolio-3d-footnote">При отсутствии актуальных mark-price данные экспозиции и стресс-оценки скрываются. Визуализация не создаёт сигналы и не управляет позициями.</p>
  </section>;
}
