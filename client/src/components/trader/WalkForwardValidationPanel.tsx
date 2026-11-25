import { useEffect, useState } from "react";
import { AlertTriangle, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";
import "./WalkForwardValidationPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const INTERVAL_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function utcDateInput(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
function percent(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}
function date(value: number): string {
  return new Date(value).toLocaleDateString("ru-RU", { timeZone: "UTC" });
}
function safeError(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "Требуется авторизованная сессия.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит запросов достигнут. Повторите позже.";
  if (code === "BAD_REQUEST") return "Недостаточно истории или параметры окон не прошли проверку. Проверьте диапазон и сохранённые свечи.";
  if (code === "SERVICE_UNAVAILABLE") return "Историческое хранилище временно недоступно.";
  return "Проверка не завершена. Проверьте доступность базы данных.";
}

export default function WalkForwardValidationPanel() {
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<(typeof MARKET_DATA_INTERVALS)[number]>("1h");
  const [startDate, setStartDate] = useState(() => utcDateInput(120));
  const [endDate, setEndDate] = useState(() => utcDateInput());
  const [trainingCandles, setTrainingCandles] = useState("500");
  const [validationCandles, setValidationCandles] = useState("100");
  const [stepCandles, setStepCandles] = useState("100");
  const [windowCount, setWindowCount] = useState("3");
  const [allowShort, setAllowShort] = useState(false);

  const startTime = Date.parse(`${startDate}T00:00:00.000Z`);
  const endTime = Date.parse(`${endDate}T23:59:59.999Z`);
  const training = Number(trainingCandles);
  const validation = Number(validationCandles);
  const step = Number(stepCandles);
  const windows = Number(windowCount);
  const barsRequired = training + (windows - 1) * step + validation;
  const rangeValid = Number.isFinite(startTime) && Number.isFinite(endTime) &&
    endTime > startTime && endTime - startTime <= 366 * 86_400_000 &&
    /^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase());
  const configValid = Number.isInteger(training) && training >= 52 && training <= 30_000 &&
    Number.isInteger(validation) && validation >= 10 && validation <= 10_000 &&
    Number.isInteger(step) && step >= validation && step <= 10_000 &&
    Number.isInteger(windows) && windows >= 2 && windows <= 12 &&
    barsRequired <= 50_000;

  const walkForward = trpc.backtesting.walkForward.useMutation();
  useEffect(() => { walkForward.reset(); }, [
    symbol, interval, startDate, endDate, trainingCandles, validationCandles, stepCandles, windowCount, allowShort,
  ]);

  const run = () => {
    if (!rangeValid || !configValid || !auth.data) return;
    walkForward.mutate({
      symbol: symbol.trim().toUpperCase(), interval, startTime, endTime,
      startingCapital: 10_000, riskBps: 50, stopLossBps: 200, takeProfitBps: 400,
      feeBps: 5, slippageBps: 5, fastEmaPeriod: 20, slowEmaPeriod: 50, allowShort,
      trainingCandles: training, validationCandles: validation, stepCandles: step, windowCount: windows,
    });
  };

  if (OFFLINE_MODE) {
    return (
      <section className="panel walk-forward-panel" id="walk-forward-validation">
        <div className="walk-forward-heading"><div><div className="eyebrow">WALK-FORWARD VALIDATION</div><h2>Проверка устойчивости стратегии</h2></div><span className="walk-forward-tag">OFFLINE APK</span></div>
        <p className="walk-forward-note">Автономная Android-сборка не подключается к серверному историческому хранилищу. Walk-Forward доступен в серверной версии.</p>
      </section>
    );
  }

  return (
    <section className="panel walk-forward-panel" id="walk-forward-validation" aria-labelledby="walk-forward-title">
      <div className="walk-forward-heading">
        <div><div className="eyebrow">WALK-FORWARD VALIDATION</div><h2 id="walk-forward-title">Проверка устойчивости стратегии</h2><p>Последовательные обучающие и out-of-sample окна на сохранённых закрытых свечах.</p></div>
        <span className="walk-forward-tag"><ShieldCheck size={13} /> RESEARCH ONLY</span>
      </div>
      <div className="walk-forward-safety"><ShieldCheck size={14} /> Параметры не оптимизируются. Каждый проверочный fold независим, а результат не создаёт сигналов или ордеров.</div>

      {auth.isLoading && <p className="walk-forward-note">Проверка авторизованной сессии…</p>}
      {auth.isError && <p className="walk-forward-error">Не удалось проверить авторизацию. Запрос не запускался.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && <p className="walk-forward-note">Для доступа к историческим данным требуется авторизация.</p>}

      {auth.data && (
        <>
          <div className="walk-forward-controls">
            <label>Символ<input value={symbol} maxLength={20} onChange={event => setSymbol(event.target.value.toUpperCase())} /></label>
            <label>Интервал<select value={interval} onChange={event => setInterval(event.target.value as (typeof MARKET_DATA_INTERVALS)[number])}>
              {INTERVAL_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Начало UTC<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <label>Конец UTC<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
          </div>
          <div className="walk-forward-window-controls">
            <label>Обучение, свечей<input type="number" min="52" max="30000" value={trainingCandles} onChange={event => setTrainingCandles(event.target.value)} /></label>
            <label>Проверка, свечей<input type="number" min="10" max="10000" value={validationCandles} onChange={event => setValidationCandles(event.target.value)} /></label>
            <label>Шаг, свечей<input type="number" min="10" max="10000" value={stepCandles} onChange={event => setStepCandles(event.target.value)} /></label>
            <label>Количество окон<input type="number" min="2" max="12" value={windowCount} onChange={event => setWindowCount(event.target.value)} /></label>
          </div>
          <div className="walk-forward-extra">
            <label><input type="checkbox" checked={allowShort} onChange={event => setAllowShort(event.target.checked)} /> Разрешить SHORT</label>
            <span>Нужно свечей: <strong>{Number.isFinite(barsRequired) ? barsRequired.toLocaleString("ru-RU") : "—"}</strong> / 50 000</span>
          </div>
          {!rangeValid && <p className="walk-forward-error">Укажите символ и корректный диапазон до 366 дней.</p>}
          {!configValid && <p className="walk-forward-error"><AlertTriangle size={13} /> Проверьте размеры окон: обучение должно покрывать EMA warm-up, проверка — от 10 свечей, шаг не меньше проверочного окна, всего от 2 до 12 окон и не более 50 000 свечей.</p>}
          <button type="button" className="walk-forward-run" onClick={run} disabled={!rangeValid || !configValid || !auth.data || walkForward.isPending}>
            <Play size={14} /> {walkForward.isPending ? "Проверка выполняется…" : "Запустить Walk-Forward"}
          </button>
          <p className="walk-forward-note">Перед запуском загрузите выбранный период на панели «История и Backtest». Здесь выполняется чтение сохранённых данных без повторной загрузки с биржи.</p>
          {walkForward.error && <p className="walk-forward-error">{safeError(walkForward.error)}</p>}
          {walkForward.data && (
            <div className="walk-forward-results">
              <div className="walk-forward-result-title"><strong>Результаты OOS проверки</strong><span>{walkForward.data.windows.length} независимых окон · {walkForward.data.candlesProcessed.toLocaleString("ru-RU")} свечей</span></div>
              <div className="walk-forward-metrics">
                <div><span>Средняя доходность OOS</span><strong>{percent(walkForward.data.metrics.averageValidationReturnPct)}</strong></div>
                <div><span>Медиана OOS</span><strong>{percent(walkForward.data.metrics.medianValidationReturnPct)}</strong></div>
                <div><span>Положительные окна</span><strong>{walkForward.data.metrics.positiveValidationWindows} / {walkForward.data.metrics.windowCount} ({percent(walkForward.data.metrics.positiveValidationWindowPct)})</strong></div>
                <div><span>Разброс доходности</span><strong>{percent(walkForward.data.metrics.validationReturnStdDevPct)}</strong></div>
                <div><span>Худшая просадка OOS</span><strong>{percent(walkForward.data.metrics.worstValidationDrawdownPct)}</strong></div>
                <div><span>Сделок OOS</span><strong>{walkForward.data.metrics.totalValidationTrades}</strong></div>
                <div><span>Win rate OOS</span><strong>{percent(walkForward.data.metrics.validationWinRatePct)}</strong></div>
                <div><span>OOS − обучение</span><strong>{percent(walkForward.data.metrics.validationMinusTrainingReturnPct)}</strong></div>
              </div>
              <div className="walk-forward-fold-table-wrap">
                <table className="walk-forward-fold-table">
                  <thead><tr><th>Окно</th><th>Проверка UTC</th><th>In-sample</th><th>Out-of-sample</th><th>Просадка OOS</th><th>Сделок</th></tr></thead>
                  <tbody>{walkForward.data.windows.map(window => (
                    <tr key={window.index}>
                      <td>{window.index}</td>
                      <td>{date(window.validationStartTime)} — {date(window.validationEndTime)}</td>
                      <td>{percent(window.training.returnPct)}</td>
                      <td>{percent(window.validation.returnPct)}</td>
                      <td>{percent(window.validation.maxDrawdownPct)}</td>
                      <td>{window.validation.totalTrades}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="walk-forward-result-foot">Run ID: {walkForward.data.runId} · SHA-256 data digest: {walkForward.data.dataDigest.slice(0, 16)}… · executionEligible=false</div>
              <details className="walk-forward-assumptions"><summary>Методика и ограничения</summary><ul>{walkForward.data.assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
