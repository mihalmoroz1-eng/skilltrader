import { ArrowDownRight, ArrowUpRight, Clock3, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ScenarioResult, Side } from "@/lib/simulation";

type Props = {
  result: ScenarioResult;
  entry: number;
  stop: number;
  target: number;
  side: Side;
  formatPrice: (value: number) => string;
  isStale?: boolean;
  levelsValid?: boolean;
};

const WIDTH = 760;
const HEIGHT = 290;
const PAD = { top: 22, right: 78, bottom: 30, left: 14 };

export default function ScenarioChart({ result, entry, stop, target, side, formatPrice, isStale = false, levelsValid = true }: Props) {
  const [selection, setSelection] = useState<{ result: ScenarioResult; index: number } | null>(null);
  const selectedTrajectory = selection?.result === result ? selection.index : null;
  const selectedPath = selectedTrajectory === null ? undefined : result.trajectories[selectedTrajectory];
  const selectedFinalPrice = selectedPath?.[selectedPath.length - 1];
  const toggleTrajectory = (index: number) => setSelection(current =>
    current?.result === result && current.index === index ? null : { result, index }
  );
  const values = [...result.lowerBand, ...result.upperBand, ...result.trajectories.flat(), stop, target, entry].filter(Number.isFinite);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.00025, 0.01);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const count = Math.max(result.median.length, 2);
  const x = (index: number) => PAD.left + (index / (count - 1)) * plotWidth;
  const y = (value: number) => PAD.top + ((max - value) / (max - min || 1)) * plotHeight;
  const bandPath = [
    ...result.upperBand.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(value)}`),
    ...result.lowerBand.map((value, index) => `L ${x(count - 1 - index)} ${y(result.lowerBand[count - 1 - index])}`),
    "Z",
  ].join(" ");
  const gridLevels = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);
  const levels = [
    { label: "ЦЕЛЬ", value: target, className: "scenario-target" },
    { label: "ВХОД", value: entry, className: "scenario-entry" },
    { label: "СТОП", value: stop, className: "scenario-stop" },
  ];

  return (
    <section className="panel scenario-panel" id="time-machine" aria-busy={isStale && levelsValid}>
      <div className="panel-heading chart-heading">
        <div>
          <div className="eyebrow">СЦЕНАРНЫЙ МОДУЛЬ <span className="tiny-demo">НЕ ПРОГНОЗ</span></div>
          <h2><Sparkles className="heading-icon" size={19} /> Машина времени</h2>
          <p className="panel-subtitle">Возможные траектории цены · {result.trials.toLocaleString("ru-RU")} испытаний</p>
        </div>
        <div className="horizon-chip"><Clock3 size={13} /> 42 шага</div>
      </div>
      <div className={`scenario-chart-content${isStale ? " is-stale" : ""}`} aria-hidden={isStale}>
      <div className="chart-toolbar scenario-toolbar">
        <div className="chart-symbol"><span className="symbol-dot violet" />Модель Монте-Карло<span className="market-status">{result.trajectories.length} траекторий показано</span></div>
        <div className={`chart-direction ${side === "long" ? "up" : "down"}`}>
          {side === "long" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {side === "long" ? "Длинная" : "Короткая"}
        </div>
      </div>
      <div className="svg-chart-wrap scenario-svg-wrap">
        <svg className="scenario-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Учебные синтетические траектории цены. Выберите линию, чтобы выделить её; стрелками можно перейти к соседним.">
          <defs>
            <linearGradient id="fanFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#a5f24c" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#a5f24c" stopOpacity="0.025" />
            </linearGradient>
          </defs>
          {gridLevels.map((level, index) => (
            <g key={`fan-grid-${index}`}>
              <line x1={PAD.left} x2={WIDTH - PAD.right + 3} y1={y(level)} y2={y(level)} className="chart-grid" />
              <text x={WIDTH - PAD.right + 10} y={y(level) + 4} className="chart-axis-label">{formatPrice(level)}</text>
            </g>
          ))}
          <path d={bandPath} fill="url(#fanFill)" className="uncertainty-band" />
          {result.trajectories.map((path, index) => {
            const points = path.map((value, point) => `${x(point)} ${y(value)}`).join(" ");
            const selected = selectedTrajectory === index;
            const pathClass = `scenario-path${selected ? " scenario-path-selected" : selectedTrajectory !== null ? " scenario-path-muted" : index % 4 === 0 ? " highlighted" : ""}`;
            const finalPrice = path[path.length - 1];
            return (
              <g
                key={`path-${index}`}
                id={`scenario-trajectory-${index}`}
                className="scenario-trajectory-control"
                role="button"
                tabIndex={selected || (selectedTrajectory === null && index === 0) ? 0 : -1}
                aria-label={`Выбрать случайную траекторию ${index + 1}; конечная условная цена ${formatPrice(finalPrice)}`}
                aria-pressed={selected}
                onClick={() => toggleTrajectory(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleTrajectory(index);
                  } else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
                    event.preventDefault();
                    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                    const next = (index + step + result.trajectories.length) % result.trajectories.length;
                    setSelection({ result, index: next });
                    document.getElementById(`scenario-trajectory-${next}`)?.focus();
                  }
                }}
              >
                <polyline points={points} className="scenario-path-hitarea" />
                <polyline points={points} className={pathClass} pointerEvents="none" />
              </g>
            );
          })}
          <polyline points={result.median.map((value, index) => `${x(index)} ${y(value)}`).join(" ")} className="scenario-median" />
          {levels.map((level) => (
            <g key={level.label}>
              <line x1={PAD.left} x2={WIDTH - PAD.right + 2} y1={y(level.value)} y2={y(level.value)} className={`scenario-level ${level.className}`} />
              <rect x={WIDTH - PAD.right + 4} y={y(level.value) - 9} width={PAD.right - 5} height="18" rx="4" className={`scenario-tag ${level.className}`} />
              <text x={WIDTH - PAD.right + 8} y={y(level.value) + 3.2} className="scenario-tag-text">{level.label} {formatPrice(level.value)}</text>
            </g>
          ))}
          <circle cx={PAD.left + 2} cy={y(entry)} r="4" className="scenario-start" />
          <text x={PAD.left} y={HEIGHT - 7} className="chart-time-label">СТАРТ</text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 7} textAnchor="end" className="chart-time-label">ГОРИЗОНТ</text>
        </svg>
      </div>
      <div className="chart-legend scenario-legend">
        <span><i className="legend-line median-legend" />Медианная траектория</span>
        <span><i className="legend-band" />Диапазон 20–80%</span>
        <span><i className="legend-line target-legend" />Цель</span>
        <span><i className="legend-line stop-legend" />Стоп</span>
      </div>
      <div className="scenario-path-selection" role={selectedPath ? "status" : "note"} aria-live="polite">
        <span>{selectedPath && selectedFinalPrice !== undefined
          ? `Выбрана случайная траектория ${selectedTrajectory! + 1} · конечная условная цена ${formatPrice(selectedFinalPrice)}. Это не прогноз и не рейтинг.`
          : "Нажмите линию, чтобы выделить один случайный путь; Tab + Enter и стрелки — с клавиатуры."}</span>
        {selectedPath && <button type="button" onClick={() => setSelection(null)}>Сбросить</button>}
      </div>
      <p className="scenario-note"><span className="note-dot" />Учебная случайная модель на синтетических данных — не прогноз, не инвестиционная рекомендация.</p>
      </div>
      {isStale && <div className="scenario-stale-overlay" role="status">{levelsValid ? "Симуляция пересчитывается для изменённых параметров. Предыдущие траектории временно скрыты." : "Исправьте направление, вход, стоп и цель, чтобы построить корректную симуляцию."}</div>}
    </section>
  );
}
