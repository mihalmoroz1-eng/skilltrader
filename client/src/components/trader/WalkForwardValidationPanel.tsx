import { useEffect, useState } from "react";
import { AlertTriangle, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";
import "./WalkForwardValidationPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const INTERVAL_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const REGIME_LABELS = { uptrend: "Восходящий тренд", downtrend: "Нисходящий тренд", ranging: "Боковое движение", high_volatility: "Высокая волатильность", transition: "Переходный режим" } as const;

function utcDateInput(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
function percent(value: number | null): string {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}
function ratio(value: number | null): string {
  return value !== null && Number.isFinite(value) ? value.toFixed(2) : "—";
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
  const [compareAllStrategies, setCompareAllStrategies] = useState(false);
  const [strategy, setStrategy] = useState<"ema_crossover" | "rsi_mean_reversion" | "macd_momentum" | "breakout">("ema_crossover");
  const [rsiPeriod, setRsiPeriod] = useState("14");
  const [rsiOversoldLevel, setRsiOversoldLevel] = useState("30");
  const [rsiOverboughtLevel, setRsiOverboughtLevel] = useState("70");
  const [macdFastPeriod, setMacdFastPeriod] = useState("12");
  const [macdSlowPeriod, setMacdSlowPeriod] = useState("26");
  const [macdSignalPeriod, setMacdSignalPeriod] = useState("9");
  const [breakoutLookbackPeriod, setBreakoutLookbackPeriod] = useState("20");
  const [breakoutBufferBps, setBreakoutBufferBps] = useState("10");

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
  const selectedWarmup = strategy === "ema_crossover" ? Number(50) + 2 : strategy === "rsi_mean_reversion" ? Number(rsiPeriod) + 3 : strategy === "macd_momentum" ? Number(macdSlowPeriod) + Number(macdSignalPeriod) + 1 : Number(breakoutLookbackPeriod) + 2;
  const allStrategiesWarmup = Math.max(52, Number(rsiPeriod) + 3, Number(macdSlowPeriod) + Number(macdSignalPeriod) + 1, Number(breakoutLookbackPeriod) + 2, 31);
  const minimumTraining = compareAllStrategies ? allStrategiesWarmup : Math.max(selectedWarmup, 31);
  const configValid = Number.isInteger(training) && training >= minimumTraining && training <= 30_000 &&
    Number.isInteger(validation) && validation >= 10 && validation <= 10_000 &&
    Number.isInteger(step) && step >= validation && step <= 10_000 &&
    Number.isInteger(windows) && windows >= 2 && windows <= 12 &&
    barsRequired <= 50_000 &&
    (strategy !== "macd_momentum" || (Number.isInteger(Number(macdFastPeriod)) && Number(macdFastPeriod) >= 2 && Number(macdFastPeriod) <= 100 && Number.isInteger(Number(macdSlowPeriod)) && Number(macdSlowPeriod) > Number(macdFastPeriod) && Number(macdSlowPeriod) <= 300 && Number.isInteger(Number(macdSignalPeriod)) && Number(macdSignalPeriod) >= 2 && Number(macdSignalPeriod) <= 100)) &&
    (strategy !== "rsi_mean_reversion" || (Number.isInteger(Number(rsiPeriod)) && Number(rsiPeriod) >= 2 && Number(rsiPeriod) <= 100 &&
      Number.isInteger(Number(rsiOversoldLevel)) && Number(rsiOversoldLevel) >= 5 && Number(rsiOversoldLevel) <= 45 &&
      Number.isInteger(Number(rsiOverboughtLevel)) && Number(rsiOverboughtLevel) <= 95 && Number(rsiOverboughtLevel) >= 55 &&
      Number(rsiOverboughtLevel) - Number(rsiOversoldLevel) >= 10)) &&
    (strategy !== "breakout" || compareAllStrategies || (Number.isInteger(Number(breakoutLookbackPeriod)) && Number(breakoutLookbackPeriod) >= 2 && Number(breakoutLookbackPeriod) <= 500 &&
      Number.isInteger(Number(breakoutBufferBps)) && Number(breakoutBufferBps) >= 0 && Number(breakoutBufferBps) <= 500)) &&
    (!compareAllStrategies || (
      Number.isInteger(Number(rsiPeriod)) && Number(rsiPeriod) >= 2 && Number(rsiPeriod) <= 100 &&
      Number.isInteger(Number(rsiOversoldLevel)) && Number(rsiOversoldLevel) >= 5 && Number(rsiOversoldLevel) <= 45 &&
      Number.isInteger(Number(rsiOverboughtLevel)) && Number(rsiOverboughtLevel) >= 55 && Number(rsiOverboughtLevel) <= 95 &&
      Number(rsiOverboughtLevel) - Number(rsiOversoldLevel) >= 10 &&
      Number.isInteger(Number(macdFastPeriod)) && Number(macdFastPeriod) >= 2 && Number(macdFastPeriod) <= 100 &&
      Number.isInteger(Number(macdSlowPeriod)) && Number(macdSlowPeriod) > Number(macdFastPeriod) && Number(macdSlowPeriod) <= 300 &&
      Number.isInteger(Number(macdSignalPeriod)) && Number(macdSignalPeriod) >= 2 && Number(macdSignalPeriod) <= 100 &&
      Number.isInteger(Number(breakoutLookbackPeriod)) && Number(breakoutLookbackPeriod) >= 2 && Number(breakoutLookbackPeriod) <= 500 &&
      Number.isInteger(Number(breakoutBufferBps)) && Number(breakoutBufferBps) >= 0 && Number(breakoutBufferBps) <= 500
    ));

  const walkForward = trpc.backtesting.walkForward.useMutation();
  const strategyPortfolio = trpc.backtesting.strategyPortfolio.useMutation();
  useEffect(() => { walkForward.reset(); strategyPortfolio.reset(); }, [
    symbol, interval, startDate, endDate, trainingCandles, validationCandles, stepCandles, windowCount, allowShort, compareAllStrategies, strategy, rsiPeriod, rsiOversoldLevel, rsiOverboughtLevel, macdFastPeriod, macdSlowPeriod, macdSignalPeriod, breakoutLookbackPeriod, breakoutBufferBps,
  ]);

  const run = () => {
    if (!rangeValid || !configValid || !auth.data) return;
    const request = {
      symbol: symbol.trim().toUpperCase(), interval, startTime, endTime,
      startingCapital: 10_000, riskBps: 50, stopLossBps: 200, takeProfitBps: 400,
      feeBps: 5, slippageBps: 5, fastEmaPeriod: 20, slowEmaPeriod: 50, allowShort,
      strategy, rsiPeriod: Number(rsiPeriod), rsiOversoldLevel: Number(rsiOversoldLevel), rsiOverboughtLevel: Number(rsiOverboughtLevel),
      macdFastPeriod: Number(macdFastPeriod), macdSlowPeriod: Number(macdSlowPeriod), macdSignalPeriod: Number(macdSignalPeriod),
      breakoutLookbackPeriod: Number(breakoutLookbackPeriod), breakoutBufferBps: Number(breakoutBufferBps),
      trainingCandles: training, validationCandles: validation, stepCandles: step, windowCount: windows,
    };
    if (compareAllStrategies) strategyPortfolio.mutate(request);
    else walkForward.mutate(request);
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
            <label>Стратегия<select value={strategy} onChange={event => setStrategy(event.target.value as "ema_crossover" | "rsi_mean_reversion" | "macd_momentum" | "breakout")}>
              <option value="ema_crossover">EMA Crossover</option>
              <option value="rsi_mean_reversion">RSI Mean Reversion</option>
              <option value="macd_momentum">MACD Momentum</option>
              <option value="breakout">Breakout</option>
            </select></label>
            {(strategy === "rsi_mean_reversion" || compareAllStrategies) && <>
              <label>RSI Period<input type="number" min="2" max="100" value={rsiPeriod} onChange={event => setRsiPeriod(event.target.value)} /></label>
              <label>RSI Oversold<input type="number" min="5" max="45" value={rsiOversoldLevel} onChange={event => setRsiOversoldLevel(event.target.value)} /></label>
              <label>RSI Overbought<input type="number" min="55" max="95" value={rsiOverboughtLevel} onChange={event => setRsiOverboughtLevel(event.target.value)} /></label>
            </>}
            {(strategy === "macd_momentum" || compareAllStrategies) && <>
              <label>MACD Fast<input type="number" min="2" max="100" value={macdFastPeriod} onChange={event => setMacdFastPeriod(event.target.value)} /></label>
              <label>MACD Slow<input type="number" min="3" max="300" value={macdSlowPeriod} onChange={event => setMacdSlowPeriod(event.target.value)} /></label>
              <label>MACD Signal<input type="number" min="2" max="100" value={macdSignalPeriod} onChange={event => setMacdSignalPeriod(event.target.value)} /></label>
            </>}
            {(strategy === "breakout" || compareAllStrategies) && <>
              <label>Breakout Lookback<input type="number" min="2" max="500" value={breakoutLookbackPeriod} onChange={event => setBreakoutLookbackPeriod(event.target.value)} /></label>
              <label>Breakout Buffer, bps<input type="number" min="0" max="500" value={breakoutBufferBps} onChange={event => setBreakoutBufferBps(event.target.value)} /></label>
            </>}
            <label>Обучение, свечей<input type="number" min="52" max="30000" value={trainingCandles} onChange={event => setTrainingCandles(event.target.value)} /></label>
            <label>Проверка, свечей<input type="number" min="10" max="10000" value={validationCandles} onChange={event => setValidationCandles(event.target.value)} /></label>
            <label>Шаг, свечей<input type="number" min="10" max="10000" value={stepCandles} onChange={event => setStepCandles(event.target.value)} /></label>
            <label>Количество окон<input type="number" min="2" max="12" value={windowCount} onChange={event => setWindowCount(event.target.value)} /></label>
          </div>
          <div className="walk-forward-extra">
            <label><input type="checkbox" checked={compareAllStrategies} onChange={event => setCompareAllStrategies(event.target.checked)} /> Сравнить все 4 стратегии на одинаковых OOS окнах</label>
            <label><input type="checkbox" checked={allowShort} onChange={event => setAllowShort(event.target.checked)} /> Разрешить SHORT</label>
            <span>Нужно свечей: <strong>{Number.isFinite(barsRequired) ? barsRequired.toLocaleString("ru-RU") : "—"}</strong> / 50 000</span>
          </div>
          {!rangeValid && <p className="walk-forward-error">Укажите символ и корректный диапазон до 366 дней.</p>}
          {!configValid && <p className="walk-forward-error"><AlertTriangle size={13} /> Проверьте размеры окон: обучение должно покрывать warm-up выбранной стратегии, проверка — от 10 свечей, шаг не меньше проверочного окна, всего от 2 до 12 окон и не более 50 000 свечей.</p>}
          <button type="button" className="walk-forward-run" onClick={run} disabled={!rangeValid || !configValid || !auth.data || walkForward.isPending || strategyPortfolio.isPending}>
            <Play size={14} /> {walkForward.isPending || strategyPortfolio.isPending ? "Проверка выполняется…" : compareAllStrategies ? "Сравнить 4 стратегии" : "Запустить Walk-Forward"}
          </button>
          <p className="walk-forward-note">Перед запуском загрузите выбранный период на панели «История и Backtest». Здесь выполняется чтение сохранённых данных без повторной загрузки с биржи.</p>
          {walkForward.error && <p className="walk-forward-error">{safeError(walkForward.error)}</p>}
          {strategyPortfolio.error && <p className="walk-forward-error">{safeError(strategyPortfolio.error)}</p>}
          {strategyPortfolio.data && (
            <div className="walk-forward-results">
              <div className="walk-forward-result-title"><strong>Strategy Portfolio Intelligence · сравнение четырёх стратегий</strong><span>{strategyPortfolio.data.strategies.length} стратегий · {strategyPortfolio.data.candlesProcessed.toLocaleString("ru-RU")} свечей</span></div>
              <p className="walk-forward-note">Все стратегии проверены на одинаковых границах обучения и OOS. Капитал каждого fold независим; доходности стратегий не объединяются в общий портфель и не используются для автоматического выбора.</p>
              <div className="walk-forward-fold-table-wrap">
                <table className="walk-forward-fold-table">
                  <thead><tr><th>Стратегия</th><th>Средняя OOS</th><th>Медиана OOS</th><th>Положит. окна</th><th>Разброс</th><th>Худшая просадка</th><th>Сделок</th><th>Средний Sharpe</th><th>Средний Sortino</th></tr></thead>
                  <tbody>{strategyPortfolio.data.strategies.map(item => (
                    <tr key={item.strategy}>
                      <td>{item.strategy === "ema_crossover" ? "EMA Crossover" : item.strategy === "rsi_mean_reversion" ? "RSI Mean Reversion" : item.strategy === "macd_momentum" ? "MACD Momentum" : "Breakout"}</td>
                      <td>{percent(item.metrics.averageValidationReturnPct)}</td>
                      <td>{percent(item.metrics.medianValidationReturnPct)}</td>
                      <td>{item.metrics.positiveValidationWindows} ({percent(item.metrics.positiveValidationWindowPct)})</td>
                      <td>{percent(item.metrics.validationReturnStdDevPct)}</td>
                      <td>{percent(item.metrics.worstValidationDrawdownPct)}</td>
                      <td>{item.metrics.totalValidationTrades}</td>
                      <td>{ratio(item.metrics.averageValidationSharpe)}</td>
                      <td>{ratio(item.metrics.averageValidationSortino)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {strategyPortfolio.data.strategies.map(item => (
                <details className="walk-forward-assumptions" key={item.strategy}>
                  <summary>{item.strategy === "ema_crossover" ? "EMA Crossover" : item.strategy === "rsi_mean_reversion" ? "RSI Mean Reversion" : item.strategy === "macd_momentum" ? "MACD Momentum" : "Breakout"} · fold breakdown</summary>
                  <div className="walk-forward-fold-table-wrap"><table className="walk-forward-fold-table">
                    <thead><tr><th>Fold</th><th>Период UTC</th><th>Обучение</th><th>OOS</th><th>Просадка</th><th>Sharpe</th><th>Sortino</th><th>Сделок</th></tr></thead>
                    <tbody>{item.folds.map(fold => <tr key={fold.index}>
                      <td>{fold.index}</td><td>{date(fold.validationStartTime)} — {date(fold.validationEndTime)}</td>
                      <td>{percent(fold.trainingReturnPct)}</td><td>{percent(fold.validationReturnPct)}</td>
                      <td>{percent(fold.maxDrawdownPct)}</td><td>{ratio(fold.sharpeRatio)}</td><td>{ratio(fold.sortinoRatio)}</td><td>{fold.totalTrades}</td>
                    </tr>)}</tbody>
                  </table></div>
                </details>
              ))}
              <div className="walk-forward-result-foot">Run ID: {strategyPortfolio.data.runId} · SHA-256: {strategyPortfolio.data.dataDigest.slice(0, 16)}… · executionEligible=false · exchangeOrderSent=false</div>
              <details className="walk-forward-assumptions"><summary>Методика сравнения</summary><ul>{strategyPortfolio.data.methodology.map(item => <li key={item}>{item}</li>)}</ul></details>
            </div>
          )}
          {walkForward.data && (
            <div className="walk-forward-results">
              <div className="walk-forward-result-title"><strong>Результаты OOS проверки · {walkForward.data.strategy === "rsi_mean_reversion" ? "RSI Mean Reversion" : walkForward.data.strategy === "macd_momentum" ? "MACD Momentum" : walkForward.data.strategy === "breakout" ? "Breakout" : "EMA Crossover"}</strong><span>{walkForward.data.windows.length} независимых окон · {walkForward.data.candlesProcessed.toLocaleString("ru-RU")} свечей</span></div>
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
              <div className="walk-forward-result-title"><strong>Риск-скорректированная устойчивость OOS</strong><span>{walkForward.data.metrics.riskAdjustedFoldCount} окон с валидным Sharpe</span></div>
              <div className="walk-forward-metrics">
                <div><span>Средний Sharpe</span><strong>{ratio(walkForward.data.metrics.averageValidationSharpe)}</strong></div>
                <div><span>Медианный Sharpe</span><strong>{ratio(walkForward.data.metrics.medianValidationSharpe)}</strong></div>
                <div><span>Худший Sharpe</span><strong>{ratio(walkForward.data.metrics.worstValidationSharpe)}</strong></div>
                <div><span>Разброс Sharpe</span><strong>{ratio(walkForward.data.metrics.validationSharpeStdDev)}</strong></div>
                <div><span>Средний Sortino</span><strong>{ratio(walkForward.data.metrics.averageValidationSortino)}</strong></div>
                <div><span>Медианный Sortino</span><strong>{ratio(walkForward.data.metrics.medianValidationSortino)}</strong></div>
                <div><span>Худший Sortino</span><strong>{ratio(walkForward.data.metrics.worstValidationSortino)}</strong></div>
                <div><span>Разброс Sortino</span><strong>{ratio(walkForward.data.metrics.validationSortinoStdDev)}</strong></div>
              </div>
              <p className="walk-forward-note">Sharpe: средняя доходность / выборочное стандартное отклонение; Sortino: средняя доходность / downside deviation. Ставка без риска и целевая доходность — 0%. Годовая нормализация зависит от интервала. Для каждого окна требуется минимум 30 доходностей; агрегаты требуют минимум два валидных окна. «—» означает недостаточную выборку или неопределённый знаменатель.</p>
              <div className="walk-forward-fold-table-wrap">
                <table className="walk-forward-fold-table">
                  <thead><tr><th>Окно</th><th>Проверка UTC</th><th>In-sample</th><th>Out-of-sample</th><th>Просадка OOS</th><th>Sharpe</th><th>Sortino</th><th>Год. волатильность</th><th>Сделок</th></tr></thead>
                  <tbody>{walkForward.data.windows.map(window => (
                    <tr key={window.index}>
                      <td>{window.index}</td>
                      <td>{date(window.validationStartTime)} — {date(window.validationEndTime)}</td>
                      <td>{percent(window.training.returnPct)}</td>
                      <td>{percent(window.validation.returnPct)}</td>
                      <td>{percent(window.validation.maxDrawdownPct)}</td>
                      <td>{ratio(window.validation.sharpeRatio)}</td>
                      <td>{ratio(window.validation.sortinoRatio)}</td>
                      <td>{percent(window.validation.annualizedVolatilityPct)}</td>
                      <td>{window.validation.totalTrades}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="walk-forward-result-title"><strong>Regime Stability Aggregator · согласованность между OOS окнами</strong><span>{walkForward.data.regimeStability.totalFolds} независимых fold</span></div>
              <p className="walk-forward-note">Сводка сравнивает независимые fold без объединения доходностей и кривых капитала. Stability Score (0–100) — эвристическая историческая оценка: покрытие fold 25%, достаточность выборки 25%, доля положительных fold 25%, контроль разброса 25%. Разброс нормируется по формуле 100 / (1 + σ / (|медиана доходности| + 5 п.п.)). Score доступен только при ≥3 fold с наблюдениями режима и ≥2 конечных доходностях. Это не вероятность, статистическая значимость или прогноз.</p>
              <div className="walk-forward-fold-table-wrap"><table className="walk-forward-fold-table">
                <thead><tr><th>Режим</th><th>Stability Score</th><th>Доказательность</th><th>Компоненты: покрытие / выборка / плюс / разброс</th><th>Fold с данными</th><th>Покрытие</th><th>Выборка ≥30</th><th>Положит. fold</th><th>Средняя доходность</th><th>Медиана</th><th>Худшая</th><th>Разброс</th><th>Средняя волатильность</th><th>Худший Sharpe</th><th>Худший Sortino</th></tr></thead>
                <tbody>{walkForward.data.regimeStability.buckets.map(item => (
                  <tr key={item.regime}>
                    <td>{REGIME_LABELS[item.regime]}</td>
                    <td>{item.stabilityScore.score === null ? "—" : item.stabilityScore.score.toFixed(1) + " / 100"}</td>
                    <td>{item.stabilityScore.rating === "high" ? "Высокая" : item.stabilityScore.rating === "moderate" ? "Средняя" : item.stabilityScore.rating === "low" ? "Низкая" : "Недостаточно данных"} · {item.stabilityScore.evidence === "strong" ? "сильная" : item.stabilityScore.evidence === "moderate" ? "умеренная" : item.stabilityScore.evidence === "limited" ? "ограниченная" : "недостаточная"}</td>
                    <td>{[item.stabilityScore.components.foldCoverage, item.stabilityScore.components.sampleAdequacy, item.stabilityScore.components.positiveReturnConsistency, item.stabilityScore.components.dispersionControl].map(value => value === null ? "—" : value.toFixed(0)).join(" / ")}</td>
                    <td>{item.foldsObserved} / {item.totalFolds}</td>
                    <td>{percent(item.foldCoveragePct)}</td>
                    <td>{item.adequateSampleFolds}</td>
                    <td>{item.positiveReturnSharePct === null ? "—" : item.positiveReturnFolds + " (" + percent(item.positiveReturnSharePct) + ")"}</td>
                    <td>{percent(item.meanConditionalReturnPct)}</td>
                    <td>{percent(item.medianConditionalReturnPct)}</td>
                    <td>{percent(item.worstConditionalReturnPct)}</td>
                    <td>{percent(item.conditionalReturnStdDevPct)}</td>
                    <td>{percent(item.meanAnnualizedVolatilityPct)}</td>
                    <td>{ratio(item.worstSharpeRatio)}</td>
                    <td>{ratio(item.worstSortinoRatio)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="walk-forward-result-title"><strong>Regime Walk-Forward · режимы внутри каждого OOS окна</strong><span>Классификация по предыдущей закрытой свече</span></div>
              {walkForward.data.windows.map(window => (
                <details className="walk-forward-assumptions" key={window.index}>
                  <summary>Окно {window.index}: {window.validation.regimePerformance.observations} интервалов · {window.validation.regimePerformance.transitionCount} смен режима</summary>
                  <div className="walk-forward-metrics">
                    <div><span>Режим последнего OOS интервала</span><strong>{window.validation.regimePerformance.currentRegime ? REGIME_LABELS[window.validation.regimePerformance.currentRegime] : "Недостаточно истории"}</strong></div>
                    <div><span>Частота смен режимов</span><strong>{percent(window.validation.regimePerformance.transitionRatePct)}</strong></div>
                    <div><span>Средняя доходность интервала смены</span><strong>{percent(window.validation.regimePerformance.transitionIntervalReturnPct)}</strong></div>
                  </div>
                  <div className="walk-forward-fold-table-wrap"><table className="walk-forward-fold-table">
                    <thead><tr><th>Режим</th><th>Интервалов</th><th>Выборка</th><th>Условная доходность</th><th>Год. волатильность</th><th>Sharpe</th><th>Sortino</th><th>Макс. просадка эпизода</th><th>Эпизодов</th></tr></thead>
                    <tbody>{window.validation.regimePerformance.buckets.map(item => (
                      <tr key={item.regime}>
                        <td>{REGIME_LABELS[item.regime]}</td><td>{item.observations}</td>
                        <td>{item.sampleStatus === "adequate_sample" ? "Достаточная" : item.sampleStatus === "limited_sample" ? "Ограниченная" : "Недостаточная"}</td>
                        <td>{percent(item.compoundedReturnPct)}</td><td>{percent(item.annualizedVolatilityPct)}</td>
                        <td>{ratio(item.sharpeRatio)}</td><td>{ratio(item.sortinoRatio)}</td>
                        <td>{percent(item.maxEpisodeDrawdownPct)}</td><td>{item.episodeCount}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  <p className="walk-forward-note">Смена режима: {window.validation.regimePerformance.transitionCount}. Показатели риска требуют минимум 30 интервалов в режиме. Годовая нормализация учитывает долю режима в окне и является описательной оценкой. Просадка считается только внутри непрерывных эпизодов.</p>
                  {window.validation.regimePerformance.transitions.length > 0 && (
                    <div className="walk-forward-fold-table-wrap"><table className="walk-forward-fold-table">
                      <thead><tr><th>Из режима</th><th>В режим</th><th>Количество</th></tr></thead>
                      <tbody>{window.validation.regimePerformance.transitions.map(item => (
                        <tr key={item.from + "-" + item.to}><td>{REGIME_LABELS[item.from]}</td><td>{REGIME_LABELS[item.to]}</td><td>{item.count}</td></tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </details>
              ))}
              <div className="walk-forward-result-foot">Run ID: {walkForward.data.runId} · SHA-256 data digest: {walkForward.data.dataDigest.slice(0, 16)}… · executionEligible=false</div>
              <details className="walk-forward-assumptions"><summary>Методика и ограничения</summary><ul>{walkForward.data.assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
