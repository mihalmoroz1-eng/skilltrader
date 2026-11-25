import { useEffect, useState } from "react";
import { AlertTriangle, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";
import "./StrategyRobustnessPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const INTERVAL_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const regimeLabels: Record<string, string> = {
  uptrend: "Восходящий тренд",
  downtrend: "Нисходящий тренд",
  ranging: "Боковой рынок",
  high_volatility: "Высокая волатильность",
  transition: "Переходный режим",
  insufficient_history: "Недостаточно истории до входа",
};

function utcDateInput(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
function pct(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}
function money(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}
function safeError(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "Требуется авторизованная сессия.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит запросов достигнут. Повторите позже.";
  if (code === "BAD_REQUEST") return "Проверьте сохранённую историю, EMA-периоды, комиссии и диапазон данных.";
  if (code === "SERVICE_UNAVAILABLE") return "Историческое хранилище временно недоступно.";
  return "Проверка не завершена. Проверьте доступность базы данных.";
}

export default function StrategyRobustnessPanel() {
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<(typeof MARKET_DATA_INTERVALS)[number]>("1h");
  const [startDate, setStartDate] = useState(() => utcDateInput(120));
  const [endDate, setEndDate] = useState(() => utcDateInput());
  const [fastEmaPeriod, setFastEmaPeriod] = useState("20");
  const [slowEmaPeriod, setSlowEmaPeriod] = useState("50");
  const [feeBps, setFeeBps] = useState("5");
  const [slippageBps, setSlippageBps] = useState("5");
  const [regimeLookback, setRegimeLookback] = useState("30");
  const [trendThresholdBps, setTrendThresholdBps] = useState("100");
  const [rangeThresholdBps, setRangeThresholdBps] = useState("50");
  const [highVolatilityThresholdBps, setHighVolatilityThresholdBps] = useState("200");
  const [allowShort, setAllowShort] = useState(false);

  const startTime = Date.parse(`${startDate}T00:00:00.000Z`);
  const endTime = Date.parse(`${endDate}T23:59:59.999Z`);
  const fast = Number(fastEmaPeriod);
  const slow = Number(slowEmaPeriod);
  const fees = Number(feeBps);
  const slippage = Number(slippageBps);
  const lookback = Number(regimeLookback);
  const trendThreshold = Number(trendThresholdBps);
  const rangeThreshold = Number(rangeThresholdBps);
  const highVolatilityThreshold = Number(highVolatilityThresholdBps);
  const rangeValid = Number.isFinite(startTime) && Number.isFinite(endTime) &&
    endTime > startTime && endTime - startTime <= 366 * 86_400_000 &&
    /^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase());
  const configValid = Number.isInteger(fast) && fast >= 2 && fast <= 100 &&
    Number.isInteger(slow) && slow > fast && slow <= 300 &&
    Number.isInteger(fees) && fees >= 0 && fees <= 50 &&
    Number.isInteger(slippage) && slippage >= 0 && slippage <= 50 &&
    Number.isInteger(lookback) && lookback >= 10 && lookback <= 200 &&
    Number.isInteger(trendThreshold) && trendThreshold >= 10 && trendThreshold <= 5_000 &&
    Number.isInteger(rangeThreshold) && rangeThreshold >= 5 && rangeThreshold <= 1_000 &&
    rangeThreshold < trendThreshold &&
    Number.isInteger(highVolatilityThreshold) && highVolatilityThreshold >= 10 && highVolatilityThreshold <= 2_000;

  const robustness = trpc.backtesting.robustness.useMutation();
  useEffect(() => {
    robustness.reset();
  }, [
    symbol, interval, startDate, endDate, fastEmaPeriod, slowEmaPeriod,
    feeBps, slippageBps, regimeLookback, trendThresholdBps, rangeThresholdBps, highVolatilityThresholdBps, allowShort,
  ]);

  const run = () => {
    if (!rangeValid || !configValid || !auth.data) return;
    robustness.mutate({
      symbol: symbol.trim().toUpperCase(), interval, startTime, endTime,
      startingCapital: 10_000, riskBps: 50, stopLossBps: 200, takeProfitBps: 400,
      feeBps: fees, slippageBps: slippage, fastEmaPeriod: fast, slowEmaPeriod: slow, allowShort,
      regimeLookback: lookback, trendThresholdBps: trendThreshold,
      rangeThresholdBps: rangeThreshold,
      highVolatilityThresholdBps: highVolatilityThreshold,
    });
  };

  if (OFFLINE_MODE) {
    return (
      <section className="panel strategy-robustness-panel" id="strategy-robustness">
        <div className="robustness-heading"><div><div className="eyebrow">STRATEGY ROBUSTNESS</div><h2>Проверка устойчивости стратегии</h2></div><span className="robustness-tag">OFFLINE APK</span></div>
        <p className="robustness-note">Автономная Android-сборка не подключается к серверному историческому хранилищу. Проверка устойчивости доступна в серверной версии.</p>
      </section>
    );
  }

  return (
    <section className="panel strategy-robustness-panel" id="strategy-robustness" aria-labelledby="strategy-robustness-title">
      <div className="robustness-heading">
        <div><div className="eyebrow">STRATEGY ROBUSTNESS ENGINE</div><h2 id="strategy-robustness-title">Стресс-тест стратегии</h2><p>Чувствительность EMA Crossover к затратам, параметрам и пяти каноническим режимам рынка.</p></div>
        <span className="robustness-tag"><ShieldCheck size={13} /> RESEARCH ONLY</span>
      </div>
      <div className="robustness-safety"><ShieldCheck size={14} /> Набор проверок фиксирован. Движок не ищет лучшие параметры, не выдаёт торговых рекомендаций и не создаёт ордера.</div>
      {auth.isLoading && <p className="robustness-note">Проверка авторизованной сессии…</p>}
      {auth.isError && <p className="robustness-error">Не удалось проверить авторизацию. Запрос не запускался.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && <p className="robustness-note">Для чтения исторических данных требуется авторизованная сессия.</p>}
      {auth.data && (
        <>
          <div className="robustness-controls">
            <label>Символ<input value={symbol} maxLength={20} onChange={event => setSymbol(event.target.value.toUpperCase())} /></label>
            <label>Интервал<select value={interval} onChange={event => setInterval(event.target.value as (typeof MARKET_DATA_INTERVALS)[number])}>
              {INTERVAL_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Начало UTC<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <label>Конец UTC<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
          </div>
          <div className="robustness-settings">
            <label>Быстрая EMA<input type="number" min="2" max="100" value={fastEmaPeriod} onChange={event => setFastEmaPeriod(event.target.value)} /></label>
            <label>Медленная EMA<input type="number" min="3" max="300" value={slowEmaPeriod} onChange={event => setSlowEmaPeriod(event.target.value)} /></label>
            <label>Комиссия, bps<input type="number" min="0" max="50" value={feeBps} onChange={event => setFeeBps(event.target.value)} /></label>
            <label>Проскальзывание, bps<input type="number" min="0" max="50" value={slippageBps} onChange={event => setSlippageBps(event.target.value)} /></label>
            <label>Окно режима<input type="number" min="10" max="200" value={regimeLookback} onChange={event => setRegimeLookback(event.target.value)} /></label>
            <label>Порог тренда, bps<input type="number" min="10" max="5000" value={trendThresholdBps} onChange={event => setTrendThresholdBps(event.target.value)} /></label>
            <label>Порог бокового рынка, bps<input type="number" min="5" max="1000" value={rangeThresholdBps} onChange={event => setRangeThresholdBps(event.target.value)} /></label>
            <label>Порог высокой волатильности, bps<input type="number" min="10" max="2000" value={highVolatilityThresholdBps} onChange={event => setHighVolatilityThresholdBps(event.target.value)} /></label>
          </div>
          <div className="robustness-extra">
            <label><input type="checkbox" checked={allowShort} onChange={event => setAllowShort(event.target.checked)} /> Разрешить SHORT</label>
            <span>Тесты: <strong>3 сценария затрат · до 8 EMA-вариантов · 5 рыночных режимов</strong></span>
          </div>
          {!rangeValid && <p className="robustness-error">Укажите символ и корректный диапазон до 366 дней.</p>}
          {!configValid && <p className="robustness-error"><AlertTriangle size={13} /> Проверьте EMA, пороги и издержки. Порог бокового рынка должен быть ниже порога тренда. Комиссия и проскальзывание — не выше 50 bps.</p>}
          <button className="robustness-run" type="button" onClick={run} disabled={!rangeValid || !configValid || !auth.data || robustness.isPending}>
            <Play size={14} /> {robustness.isPending ? "Выполняется стресс-тест…" : "Запустить проверку устойчивости"}
          </button>
          <p className="robustness-note">До запуска загрузите нужные свечи через «История и Backtest». Этот модуль читает только сохранённые данные.</p>
          {robustness.error && <p className="robustness-error">{safeError(robustness.error)}</p>}
          {robustness.data && (
            <div className="robustness-results">
              <div className="robustness-result-heading"><strong>Результат проверки</strong><span>{robustness.data.candlesProcessed.toLocaleString("ru-RU")} свечей · {robustness.data.baseline.totalTrades} базовых сделок</span></div>
              <div className="robustness-metrics">
                <div><span>Базовая доходность</span><strong>{pct(robustness.data.baseline.returnPct)}</strong></div>
                <div><span>Худшая доходность при затратах</span><strong>{pct(robustness.data.metrics.worstCostStressReturnPct)}</strong></div>
                <div><span>Изменение при стресс-затратах</span><strong>{pct(robustness.data.metrics.costStressReturnChangePct)}</strong></div>
                <div><span>Разброс EMA-вариантов</span><strong>{pct(robustness.data.metrics.parameterReturnSpreadPct)}</strong></div>
                <div><span>Прибыльные EMA-варианты</span><strong>{pct(robustness.data.metrics.profitableParameterVariantsPct)}</strong></div>
                <div><span>Худшая просадка EMA-вариантов</span><strong>{pct(robustness.data.metrics.worstParameterDrawdownPct)}</strong></div>
              </div>
              <div className="robustness-table-section">
                <h3>Чувствительность к затратам</h3>
                <div className="robustness-table-wrap"><table><thead><tr><th>Сценарий</th><th>Комиссия</th><th>Проскальзывание</th><th>Доходность</th><th>Просадка</th><th>Сделок</th></tr></thead>
                  <tbody>{robustness.data.costScenarios.map(item => <tr key={item.id}><td>{item.multiplier}x</td><td>{item.feeBps} bps</td><td>{item.slippageBps} bps</td><td>{pct(item.returnPct)}</td><td>{pct(item.maxDrawdownPct)}</td><td>{item.totalTrades}</td></tr>)}</tbody>
                </table></div>
              </div>
              <div className="robustness-table-section">
                <h3>Соседние параметры EMA</h3>
                <div className="robustness-table-wrap"><table><thead><tr><th>Вариант</th><th>Быстрая EMA</th><th>Медленная EMA</th><th>Доходность</th><th>Изменение к базе</th><th>Просадка</th></tr></thead>
                  <tbody>{robustness.data.parameterScenarios.map(item => <tr key={item.id}><td>{item.id}</td><td>{item.fastEmaPeriod}</td><td>{item.slowEmaPeriod}</td><td>{pct(item.returnPct)}</td><td>{pct(item.returnDeltaFromBaselinePct)}</td><td>{pct(item.maxDrawdownPct)}</td></tr>)}</tbody>
                </table></div>
              </div>
              <div className="robustness-table-section">
                <h3>Распределение сделок по режиму на момент входа</h3>
                <div className="robustness-table-wrap"><table><thead><tr><th>Режим</th><th>Сделок</th><th>Выборка</th><th>Win rate</th><th>Чистый PnL</th><th>Средняя сделка</th><th>Profit Factor</th></tr></thead>
                  <tbody>{robustness.data.regimes.map(item => <tr key={item.id}><td>{regimeLabels[item.id] ?? item.label}</td><td>{item.tradeCount}</td><td>{item.sampleStatus === "adequate_sample" ? "Достаточная" : "Мало данных"}</td><td>{pct(item.winRatePct)}</td><td>{money(item.netPnl)}</td><td>{money(item.averageTradePnl)}</td><td>{item.profitFactor === null ? "∞" : item.profitFactor.toFixed(2)}</td></tr>)}</tbody>
                </table></div>
              </div>
              <div className="robustness-result-foot">Run ID: {robustness.data.runId} · SHA-256: {robustness.data.dataDigest.slice(0, 16)}… · executionEligible=false</div>
              <details className="robustness-assumptions"><summary>Методика и ограничения</summary><ul>{robustness.data.assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
