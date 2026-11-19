import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import {
  CANDLE_INTERVALS_MS,
  formatCandleCountdown,
  getCandleTimeRemaining,
  type CandleTimeframe,
} from "@/lib/candleTimer";

type Props = { timeframe: CandleTimeframe };

export default function CandleTimer({ timeframe }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const intervalMs = CANDLE_INTERVALS_MS[timeframe];
  const remainingMs = getCandleTimeRemaining(nowMs, intervalMs);
  const elapsedPercent = Math.round(((intervalMs - remainingMs) / intervalMs) * 100);
  const countdown = formatCandleCountdown(remainingMs);

  useEffect(() => {
    const updateTimer = () => setNowMs(Date.now());
    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="panel timer-placeholder">
      <div className="bottom-info-icon blue"><Clock3 size={16} /></div>
      <div className="timer-content">
        <div className="timer-kicker">УЧЕБНЫЙ ТАЙМЕР · {timeframe}</div>
        <div className="timer-main">
          <div className="timer-title-wrap">
            <strong className="timer-title">До следующей границы</strong>
            <p>Период синхронизирован с графиком</p>
          </div>
          <time className="timer-countdown" role="timer" aria-label={`Осталось ${countdown} для периода ${timeframe}`} aria-live="off">{countdown}</time>
        </div>
        <div className="timer-progress" role="progressbar" aria-label={`Прошедшая доля интервала ${timeframe}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={elapsedPercent}>
          <span style={{ width: `${elapsedPercent}%` }} />
        </div>
        <div className="timer-footnote">
          <span>Не анализирует рынок и не даёт сигналов</span>
          <span className="module-chip offline">БЕЗ СИГНАЛА</span>
        </div>
      </div>
    </div>
  );
}
