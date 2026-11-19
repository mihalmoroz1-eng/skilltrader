import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ShieldCheck } from "lucide-react";
import type { Side } from "@/lib/simulation";

type Props = {
  entry: number;
  stop: number;
  target: number;
  side: Side;
  size: number;
  sizeUnit: string;
  formatSize: (value: number) => string;
  balance: number;
  maxRiskPercent: number;
  valid: boolean;
  formatMoney: (value: number) => string;
};

export default function RiskPanel({ entry, stop, target, side, size, sizeUnit, formatSize, balance, maxRiskPercent, valid, formatMoney }: Props) {
  const risk = Math.abs(entry - stop) * size;
  const reward = Math.abs(target - entry) * size;
  const riskPercent = balance > 0 ? (risk / balance) * 100 : 0;
  const rewardRisk = risk > 0 ? reward / risk : 0;
  const isElevated = riskPercent > maxRiskPercent;
  const meterMaxPercent = Math.max(5, Math.ceil(maxRiskPercent * 2));
  const meterWidth = Math.min(100, (riskPercent / meterMaxPercent) * 100);
  const limitPosition = Math.min(100, (maxRiskPercent / meterMaxPercent) * 100);
  const formatPercent = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <section className="panel risk-panel" id="risk-manager">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">КОНТРОЛЬ РИСКА</div>
          <h2><ShieldCheck className="heading-icon lime-text" size={19} /> Риск-менеджер</h2>
        </div>
        <span className={`risk-status ${!valid ? "invalid" : isElevated ? "elevated" : "safe"}`}>
          {!valid ? <AlertTriangle size={13} /> : isElevated ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
          {!valid ? "Проверь уровни" : isElevated ? "Выше лимита" : "В рамках лимита"}
        </span>
      </div>
      <div className="risk-big-number">
        <div><span className="eyebrow">УЧЕБНЫЙ РИСК</span><strong>{formatMoney(risk)}</strong></div>
        <span className={`risk-pct ${isElevated ? "over-limit" : ""}`}>{riskPercent.toFixed(2)}<small>%</small></span>
      </div>
      <div className="risk-meter">
        <span style={{ width: `${meterWidth}%` }} className={isElevated ? "meter-hot" : ""} />
        <i className="risk-limit-marker" style={{ left: `${limitPosition}%` }} aria-hidden="true" />
      </div>
      <div className="risk-meter-labels"><span>0%</span><span>лимит {formatPercent(maxRiskPercent)}%</span><span>{formatPercent(meterMaxPercent)}%</span></div>
      <div className="risk-breakdown">
        <div className="risk-line"><span><span className="risk-line-icon muted"><ArrowDownRight size={14} /></span>Если достигнет стопа</span><b className="text-coral">−{formatMoney(risk)}</b></div>
        <div className="risk-line"><span><span className="risk-line-icon muted"><ArrowUpRight size={14} /></span>Если достигнет цели</span><b className="text-lime">+{formatMoney(reward)}</b></div>
        <div className="risk-line"><span>Прибыль / риск</span><b className="rr-value">{rewardRisk.toFixed(2)} <small>R</small></b></div>
        <div className="risk-line"><span>Размер позиции</span><b>{formatSize(size)}</b></div>
      </div>
      {!valid && <div className="risk-warning"><AlertTriangle size={14} /> Для выбранного направления цель и стоп должны располагаться по разные стороны от входа.</div>}
      <p className="risk-disclaimer">Объём указан в {sizeUnit} как учебное допущение, не спецификация брокера. Расчёт не является рекомендацией или заявкой.</p>
    </section>
  );
}
