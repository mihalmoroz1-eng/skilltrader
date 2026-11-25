import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Box, Rotate3D, Sparkles } from "lucide-react";
import type { PriceCandle } from "@/lib/simulation";
import type { CandleTimeframe } from "@/lib/candleTimer";
import "./Market3DScene.css";

type Props = {
  candles: PriceCandle[];
  symbol: string;
  timeframe: CandleTimeframe;
  formatPrice: (value: number) => string;
};

const WIDTH = 920;
const HEIGHT = 320;
const LEFT = 46;
const RIGHT = 790;
const BASE_Y = 246;
const CHART_HEIGHT = 172;

export default function Market3DScene({ candles, symbol, timeframe, formatPrice }: Props) {
  const [deepView, setDeepView] = useState(false);
  const visible = useMemo(() => candles.slice(-42), [candles]);
  const stats = useMemo(() => {
    const first = visible[0]?.close ?? 0;
    const last = visible[visible.length - 1]?.close ?? 0;
    const high = visible.reduce((value, candle) => Math.max(value, candle.high), -Infinity);
    const low = visible.reduce((value, candle) => Math.min(value, candle.low), Infinity);
    return {
      first, last,
      high: Number.isFinite(high) ? high : 0,
      low: Number.isFinite(low) ? low : 0,
      changePct: first > 0 ? ((last - first) / first) * 100 : 0,
    };
  }, [visible]);
  const rawMin = stats.low;
  const rawMax = stats.high;
  const pad = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.00025, 0.01);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const scaleY = (value: number) => BASE_Y - ((value - min) / (max - min || 1)) * CHART_HEIGHT;
  const step = (RIGHT - LEFT) / Math.max(visible.length, 1);
  const bodyWidth = Math.max(5, Math.min(11, step * 0.58));
  const extrudeX = 6;
  const extrudeY = -4;
  const depthX = deepView ? 112 : 76;
  const depthY = deepView ? -64 : -44;
  const floor = [
    [LEFT, BASE_Y], [RIGHT, BASE_Y],
    [RIGHT + depthX, BASE_Y + depthY], [LEFT + depthX, BASE_Y + depthY],
  ].map(point => point.join(",")).join(" ");
  const depthLines = Array.from({ length: 9 }, (_, index) => {
    const x = LEFT + ((RIGHT - LEFT) * index) / 8;
    return { x1: x, y1: BASE_Y, x2: x + depthX, y2: BASE_Y + depthY };
  });
  const crossLines = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      x1: LEFT + depthX * ratio,
      y1: BASE_Y + depthY * ratio,
      x2: RIGHT + depthX * ratio,
      y2: BASE_Y + depthY * ratio,
    };
  });
  const directionUp = stats.changePct >= 0;

  return (
    <section className="panel market-3d-panel" id="market-3d-scene" aria-labelledby="market-3d-title">
      <div className="market-3d-heading">
        <div>
          <div className="eyebrow">3D MARKET TERRAIN <span className="market-3d-label">· SYNTHETIC DATA</span></div>
          <h2 id="market-3d-title"><Box size={18} /> Рынок в объёме</h2>
          <p>Изометрическая визуализация свечей OHLC с перспективой, глубиной и подсветкой движения цены.</p>
        </div>
        <div className="market-3d-heading-tags">
          <span className="market-3d-tag"><Sparkles size={12} /> 3D SCENE</span>
          <span className="market-3d-tag muted">{timeframe}</span>
        </div>
      </div>

      <div className="market-3d-layout">
        <div className="market-3d-copy">
          <div className="market-3d-symbol-row"><span className="market-3d-live-dot" />{symbol}<span>DEMO MARKET</span></div>
          <div className="market-3d-price">{formatPrice(stats.last)}</div>
          <div className={`market-3d-change ${directionUp ? "positive" : "negative"}`}>
            {directionUp ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
            {directionUp ? "+" : ""}{stats.changePct.toFixed(2)}%
            <span>к первой свече сцены</span>
          </div>
          <div className="market-3d-stats">
            <div><span>HIGH</span><strong>{formatPrice(stats.high)}</strong></div>
            <div><span>LOW</span><strong>{formatPrice(stats.low)}</strong></div>
            <div><span>СВЕЧЕЙ</span><strong>{visible.length.toString().padStart(2, "0")}</strong></div>
          </div>
          <div className="market-3d-note"><Activity size={13} /> Синтетическая учебная серия. Не является рыночной котировкой или торговым сигналом.</div>
        </div>

        <div className="market-3d-stage" data-view={deepView ? "deep" : "wide"}>
          <div className="market-3d-stage-glow" />
          <div className="market-3d-floor-grid" />
          <div className="market-3d-orbit market-3d-orbit-one" />
          <div className="market-3d-orbit market-3d-orbit-two" />
          <div className="market-3d-coin" aria-hidden="true">
            <span className="market-3d-coin-edge" />
            <span className="market-3d-coin-face">ST</span>
            <span className="market-3d-coin-back">ST</span>
          </div>
          <div className="market-3d-float market-3d-float-top"><span>PRICE STRUCTURE</span><strong>{symbol}</strong></div>
          <div className="market-3d-float market-3d-float-bottom"><span>VOLATILITY</span><strong>{Math.abs(stats.high - stats.low) > 0 ? ((stats.high - stats.low) / Math.max(stats.last, 0.0000001) * 100).toFixed(2) : "0.00"}%</strong></div>
          <svg
            className="market-3d-svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`Изометрический 3D-график ${symbol}: ${visible.length} демонстрационных свечей OHLC за ${timeframe}`}
          >
            <defs>
              <linearGradient id="market3dFloor" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#75a8ff" stopOpacity=".09" />
                <stop offset="100%" stopColor="#75a8ff" stopOpacity=".015" />
              </linearGradient>
              <linearGradient id="market3dGlow" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#75a8ff" stopOpacity="0" />
                <stop offset="55%" stopColor="#a5f24c" stopOpacity=".28" />
                <stop offset="100%" stopColor="#a5f24c" stopOpacity="0" />
              </linearGradient>
              <filter id="market3dSoftGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            <polygon points={floor} fill="url(#market3dFloor)" stroke="#75a8ff" strokeOpacity=".21" />
            {depthLines.map((line, index) => (
              <line key={`depth-${index}`} {...line} className="market-3d-grid-line" />
            ))}
            {crossLines.map((line, index) => (
              <line key={`cross-${index}`} {...line} className="market-3d-grid-line" />
            ))}
            <path d={`M ${LEFT} ${BASE_Y} L ${RIGHT} ${BASE_Y}`} className="market-3d-axis" />
            {visible.map((candle, index) => {
              const x = LEFT + index * step + step / 2;
              const up = candle.close >= candle.open;
              const top = scaleY(Math.max(candle.open, candle.close));
              const bottom = scaleY(Math.min(candle.open, candle.close));
              const height = Math.max(3, bottom - top);
              const high = scaleY(candle.high);
              const low = scaleY(candle.low);
              const color = up ? "#a5f24c" : "#ff756f";
              const sideColor = up ? "#527d2b" : "#9e4848";
              const topColor = up ? "#d5ffa1" : "#ffb1aa";
              const topFace = `${x},${top} ${x + extrudeX},${top + extrudeY} ${x + bodyWidth + extrudeX},${top + extrudeY} ${x + bodyWidth},${top}`;
              const sideFace = `${x + bodyWidth},${top} ${x + bodyWidth + extrudeX},${top + extrudeY} ${x + bodyWidth + extrudeX},${bottom + extrudeY} ${x + bodyWidth},${bottom}`;
              const frontFace = `${x},${top} ${x + bodyWidth},${top} ${x + bodyWidth},${bottom} ${x},${bottom}`;
              return (
                <g key={`${candle.timestamp}-${index}`} className="market-3d-candle">
                  <title>{`${candle.time} · O ${formatPrice(candle.open)} · H ${formatPrice(candle.high)} · L ${formatPrice(candle.low)} · C ${formatPrice(candle.close)}`}</title>
                  <line x1={x + bodyWidth / 2} x2={x + bodyWidth / 2} y1={high} y2={low} stroke={color} strokeWidth="1.5" />
                  <line x1={x + bodyWidth / 2} x2={x + bodyWidth / 2} y1={low} y2={BASE_Y} stroke={color} strokeOpacity=".13" strokeDasharray="2 5" />
                  <polygon points={topFace} fill={topColor} fillOpacity=".9" />
                  <polygon points={sideFace} fill={sideColor} fillOpacity=".92" />
                  <polygon points={frontFace} fill={color} fillOpacity=".78" stroke={color} strokeOpacity=".8" strokeWidth=".7" />
                  <line x1={x + 1} x2={x + bodyWidth - 1} y1={top + 1} y2={top + 1} stroke="#ffffff" strokeOpacity=".34" strokeWidth=".7" />
                </g>
              );
            })}
            <path
              d={visible.map((candle, index) => `${index === 0 ? "M" : "L"} ${LEFT + index * step + step / 2 + bodyWidth / 2} ${scaleY(candle.close) - 3}`).join(" ")}
              fill="none" stroke="#a5f24c" strokeOpacity=".24" strokeWidth="5" filter="url(#market3dSoftGlow)"
              className="market-3d-close-glow"
            />
            <path
              d={visible.map((candle, index) => `${index === 0 ? "M" : "L"} ${LEFT + index * step + step / 2 + bodyWidth / 2} ${scaleY(candle.close) - 3}`).join(" ")}
              fill="none" stroke="url(#market3dGlow)" strokeWidth="1.2" className="market-3d-close-line"
            />
            <text x={LEFT} y="290" className="market-3d-axis-label">PAST</text>
            <text x={RIGHT} y="290" textAnchor="end" className="market-3d-axis-label">NOW</text>
            <text x={RIGHT + depthX - 4} y={BASE_Y + depthY - 7} textAnchor="end" className="market-3d-axis-label">TIME →</text>
          </svg>
          <button
            type="button"
            className="market-3d-view-toggle"
            onClick={() => setDeepView(current => !current)}
            aria-pressed={deepView}
          >
            <Rotate3D size={13} /> {deepView ? "Глубокая перспектива" : "Широкая перспектива"}
          </button>
        </div>
      </div>
    </section>
  );
}
