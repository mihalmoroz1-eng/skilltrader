import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { DEMO_CANDLE_INTERVAL_MS, formatCandleCountdown, getCandleTimeRemaining } from "@/lib/candleTimer";

export default function CandleTimer() {
  const [remainingMs, setRemainingMs] = useState(() => getCandleTimeRemaining(Date.now()));
  const elapsedPercent = Math.round(((DEMO_CANDLE_INTERVAL_MS - remainingMs) / DEMO_CANDLE_INTERVAL_MS) * 100);

  useEffect(() => {
    const updateTimer = () => setRemainingMs(getCandleTimeRemaining(Date.now()));
    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const countdown = formatCandleCountdown(remainingMs);

  return (
    <div className="panel timer-placeholder">
      <div className="bottom-info-icon blue"><Clock3 size={16} /></div>
      <div className="timer-content">
        <div className="timer-kicker">УЧЕБНЫЙ ТАЙМЕР · 15 МИН</div>
        <div className="timer-main">
          <div className="timer-title-wrap">
            <strong className="timer-title">До следующей границы</strong>
            <p>Условное закрытие свечи по часам браузера</p>
          </div>
          <time className="timer-countdown" role="timer" aria-label={`Осталось ${countdown}`} aria-live="off">{countdown}</time>
        </div>
        <div className="timer-progress" role="progressbar" aria-label="Прошедшая доля условного 15-минутного интервала" aria-valuemin={0} aria-valuemax={100} aria-valuenow={elapsedPercent}>
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
