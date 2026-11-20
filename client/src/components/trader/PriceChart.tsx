import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react";
import type { PriceCandle, Side } from "@/lib/simulation";
import type { CandleTimeframe } from "@/lib/candleTimer";

type Props = {
  candles: PriceCandle[];
  symbol: string;
  entry: number;
  stop: number;
  target: number;
  side: Side;
  timeframe: CandleTimeframe;
  onTimeframeChange: (timeframe: CandleTimeframe) => void;
  formatPrice: (value: number) => string;
};

const WIDTH = 760;
const HEIGHT = 300;
const PAD = { top: 18, right: 82, bottom: 30, left: 14 };
const TIMEFRAMES: CandleTimeframe[] = ["15м", "1ч", "4ч"];

export default function PriceChart({ candles, symbol, entry, stop, target, side, timeframe, onTimeframeChange, formatPrice }: Props) {
  const visibleCandles = useMemo(() => {
    const amount = timeframe === "15м" ? 40 : timeframe === "1ч" ? 52 : 64;
    return candles.slice(-amount);
  }, [candles, timeframe]);

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const values = [
    ...visibleCandles.flatMap((candle) => [candle.high, candle.low]),
    entry,
    stop,
    target,
  ].filter(Number.isFinite);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.00025, 0.01);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const y = (value: number) => PAD.top + ((max - value) / (max - min || 1)) * plotHeight;
  const step = plotWidth / Math.max(visibleCandles.length, 1);
  const candleWidth = Math.max(3, Math.min(9, step * 0.56));
  const gridLevels = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);
  const timeMarkers = [
    { index: 0, anchor: "start" as const },
    { index: Math.floor((visibleCandles.length - 1) / 2), anchor: "middle" as const },
    { index: visibleCandles.length - 1, anchor: "end" as const },
  ];
  const levels = [
    { label: "ЦЕЛЬ", value: target, className: "level-target" },
    { label: "ВХОД", value: entry, className: "level-entry" },
    { label: "СТОП", value: stop, className: "level-stop" },
  ];

  return (
    <section className="panel chart-panel" id="price-chart">
      <div className="panel-heading chart-heading">
        <div>
          <div className="eyebrow">ОБЗОР РЫНКА <span className="tiny-demo">УЧЕБНЫЕ ДАННЫЕ</span></div>
          <h2>График цены</h2>
          <p className="panel-subtitle">{symbol} · синтетические свечи OHLC</p>
        </div>
        <button className="chart-menu-button" type="button" aria-label="Настройки графика">
          Настроить <ChevronDown size={14} />
        </button>
      </div>
      <div className="chart-toolbar">
        <div className="chart-symbol"><span className="symbol-dot" />{symbol}<span className="market-status">Демо-поток</span></div>
        <div className="timeframe-group" aria-label="Период графика">
          {TIMEFRAMES.map((item) => (
            <button
              key={item}
              type="button"
              className={timeframe === item ? "timeframe active" : "timeframe"}
              onClick={() => onTimeframeChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className={`chart-direction ${side === "long" ? "up" : "down"}`}>
          {side === "long" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {side === "long" ? "Покупка" : "Продажа"}
        </div>
      </div>
      <div className="svg-chart-wrap">
        <svg className="price-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${symbol}, ${timeframe}: учебные свечи и уровни сделки`}>
          <defs>
            <linearGradient id="priceFade" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#a5f24c" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#a5f24c" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridLevels.map((level, index) => (
            <g key={`grid-${index}`}>
              <line x1={PAD.left} x2={WIDTH - PAD.right + 4} y1={y(level)} y2={y(level)} className="chart-grid" />
              <text x={WIDTH - PAD.right + 11} y={y(level) + 4} className="chart-axis-label">{formatPrice(level)}</text>
            </g>
          ))}
          <path
            d={`M ${PAD.left} ${HEIGHT - PAD.bottom} ${visibleCandles.map((candle, index) => `L ${PAD.left + index * step + step / 2} ${y(candle.close)}`).join(" ")} L ${WIDTH - PAD.right} ${HEIGHT - PAD.bottom} Z`}
            fill="url(#priceFade)"
          />
          {visibleCandles.map((candle, index) => {
            const centerX = PAD.left + index * step + step / 2;
            const isUp = candle.close >= candle.open;
            const top = y(Math.max(candle.open, candle.close));
            const bodyHeight = Math.max(2, Math.abs(y(candle.open) - y(candle.close)));
            return (
              <g key={`${candle.time}-${index}`} className={isUp ? "candle-up" : "candle-down"}>
                <title>{`${candle.time} · O ${formatPrice(candle.open)} · H ${formatPrice(candle.high)} · L ${formatPrice(candle.low)} · C ${formatPrice(candle.close)}`}</title>
                <line x1={centerX} x2={centerX} y1={y(candle.high)} y2={y(candle.low)} className="candle-wick" />
                <rect x={centerX - candleWidth / 2} y={top} width={candleWidth} height={bodyHeight} rx="1" className="candle-body" />
              </g>
            );
          })}
          {levels.map((level) => (
            <g key={level.label}>
              <line x1={PAD.left} x2={WIDTH - PAD.right + 2} y1={y(level.value)} y2={y(level.value)} className={`price-level ${level.className}`} />
              <rect x={WIDTH - PAD.right + 4} y={y(level.value) - 10} width={PAD.right - 6} height="19" rx="4" className={`price-tag ${level.className}`} />
              <text x={WIDTH - PAD.right + 9} y={y(level.value) + 3.5} className="price-tag-text">{level.label} {formatPrice(level.value)}</text>
            </g>
          ))}
          {timeMarkers.map(({ index, anchor }, markerIndex) => {
            const candle = visibleCandles[index];
            if (!candle) return null;
            const x = PAD.left + index * step + step / 2;
            return <text key={`time-${markerIndex}`} x={x} y={HEIGHT - 7} textAnchor={anchor} className="chart-time-label">{candle.time}</text>;
          })}
        </svg>
      </div>
      <div className="chart-legend">
        <span><i className="legend-dot candle-legend-up" />Рост</span>
        <span><i className="legend-dot candle-legend-down" />Снижение</span>
        <span><i className="legend-line entry-legend" />Вход</span>
        <span><i className="legend-line stop-legend" />Стоп</span>
        <span><i className="legend-line target-legend" />Цель</span>
      </div>
    </section>
  );
}
