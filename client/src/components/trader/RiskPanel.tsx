import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ShieldCheck } from "lucide-react";
import type { Side } from "@/lib/simulation";

type Props = {
  entry: number;
  stop: number;
  target: number;
  side: Side;
  size: number;
  balance: number;
  valid: boolean;
  formatMoney: (value: number) => string;
};

export default function RiskPanel({ entry, stop, target, side, size, balance, valid, formatMoney }: Props) {
  const risk = Math.abs(entry - stop) * size;
  const reward = Math.abs(target - entry) * size;
  const riskPercent = balance > 0 ? (risk / balance) * 100 : 0;
  const rewardRisk = risk > 0 ? reward / risk : 0;
  const isElevated = riskPercent >= 2;

  return (
    <section className="panel risk-panel" id="risk-manager">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">КОНТРОЛЬ РИСКА</div>
          <h2><ShieldCheck className="heading-icon lime-text" size={19} /> Риск-менеджер</h2>
        </div>
        <span className={`risk-status ${!valid ? "invalid" : isElevated ? "elevated" : "safe"}`}>
          {!valid ? <AlertTriangle size={13} /> : isElevated ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
          {!valid ? "Проверь уровни" : isElevated ? "Выше 2%" : "В рамках"}
        </span>
      </div>
      <div className="risk-big-number">
        <div><span className="eyebrow">УЧЕБНЫЙ РИСК</span><strong>{formatMoney(risk)}</strong></div>
        <span className="risk-pct">{riskPercent.toFixed(2)}<small>%</small></span>
      </div>
      <div className="risk-meter"><span style={{ width: `${Math.min(100, (riskPercent / 5) * 100)}%` }} className={isElevated ? "meter-hot" : ""} /></div>
      <div className="risk-meter-labels"><span>0%</span><span>лимит 2%</span><span>5%</span></div>
      <div className="risk-breakdown">
        <div className="risk-line"><span><span className="risk-line-icon muted"><ArrowDownRight size={14} /></span>Если достигнет стопа</span><b className="text-coral">−{formatMoney(risk)}</b></div>
        <div className="risk-line"><span><span className="risk-line-icon muted"><ArrowUpRight size={14} /></span>Если достигнет цели</span><b className="text-lime">+{formatMoney(reward)}</b></div>
        <div className="risk-line"><span>Прибыль / риск</span><b className="rr-value">{rewardRisk.toFixed(2)} <small>R</small></b></div>
        <div className="risk-line"><span>Размер позиции</span><b>{size.toFixed(2)} ед.</b></div>
      </div>
      {!valid && <div className="risk-warning"><AlertTriangle size={14} /> Для выбранного направления цель и стоп должны располагаться по разные стороны от входа.</div>}
      <p className="risk-disclaimer">Упрощённый учебный расчёт в условных единицах. Это не финансовая рекомендация и не заявка брокеру.</p>
    </section>
  );
}
