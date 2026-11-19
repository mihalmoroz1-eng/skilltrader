import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { ScenarioResult, Side } from "@/lib/simulation";

type Props = { result: ScenarioResult; side: Side };

export default function OutcomeDistribution({ result, side }: Props) {
  const outcomes = [
    { title: side === "long" ? "Достижение цели" : "Достижение цели", value: result.targetProbability, icon: ArrowUp, color: "lime", note: "целевая цена" },
    { title: "Срабатывание стопа", value: result.stopProbability, icon: ArrowDown, color: "coral", note: "уровень риска" },
    { title: "Без касания уровней", value: result.otherProbability, icon: ArrowRight, color: "blue", note: "до конца горизонта" },
  ];

  return (
    <div className="outcome-list" aria-label="Доли результатов симуляции">
      {outcomes.map(({ title, value, icon: Icon, color, note }) => (
        <div className="outcome-row" key={title}>
          <div className="outcome-topline">
            <div className="outcome-title"><span className={`outcome-icon ${color}`}><Icon size={14} /></span><span>{title}<small>{note}</small></span></div>
            <strong className={`outcome-value ${color}`}>{value.toFixed(1)}<small>%</small></strong>
          </div>
          <div className="outcome-track"><span className={`outcome-fill ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
