import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";
import "./StrategyBenchmarkPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const INTERVAL_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function utcDateInput(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
function pct(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}
function ratio(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2); }
function money(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}
function safeError(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "Требуется авторизованная сессия.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит запросов достигнут. Повторите позже.";
  if (code === "BAD_REQUEST") return "Проверьте период, доступную историю и параметры EMA.";
  if (code === "SERVICE_UNAVAILABLE") return "Историческое хранилище временно недоступно.";
  return "Сравнение не завершено. Проверьте доступность базы данных.";
}

export default function StrategyBenchmarkPanel() {
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<(typeof MARKET_DATA_INTERVALS)[number]>("1h");
  const [startDate, setStartDate] = useState(() => utcDateInput(120));
  const [endDate, setEndDate] = useState(() => utcDateInput());
  const [startingCapital, setStartingCapital] = useState("10000");
  const [fastEmaPeriod, setFastEmaPeriod] = useState("20");
  const [slowEmaPeriod, setSlowEmaPeriod] = useState("50");
  const [riskBps, setRiskBps] = useState("50");
  const [stopLossBps, setStopLossBps] = useState("200");
  const [takeProfitBps, setTakeProfitBps] = useState("400");
  const [feeBps, setFeeBps] = useState("5");
  const [slippageBps, setSlippageBps] = useState("5");
  const [allowShort, setAllowShort] = useState(false);

  const startTime = Date.parse(`${startDate}T00:00:00.000Z`);
  const endTime = Date.parse(`${endDate}T23:59:59.999Z`);
  const capital = Number(startingCapital);
  const fast = Number(fastEmaPeriod);
  const slow = Number(slowEmaPeriod);
  const risk = Number(riskBps);
  const stop = Number(stopLossBps);
  const target = Number(takeProfitBps);
  const fee = Number(feeBps);
  const slippage = Number(slippageBps);
  const rangeValid = Number.isFinite(startTime) && Number.isFinite(endTime) &&
    endTime > startTime && endTime - startTime <= 366 * 86_400_000 &&
    /^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase());
  const configValid = Number.isFinite(capital) && capital >= 1 && capital <= 1_000_000_000 &&
    Number.isInteger(fast) && fast >= 2 && fast <= 100 &&
    Number.isInteger(slow) && slow > fast && slow <= 300 &&
    Number.isInteger(risk) && risk >= 1 && risk <= 1_000 &&
    Number.isInteger(stop) && stop >= 10 && stop <= 5_000 && risk < stop &&
    Number.isInteger(target) && target >= 10 && target <= 10_000 &&
    Number.isInteger(fee) && fee >= 0 && fee <= 100 &&
    Number.isInteger(slippage) && slippage >= 0 && slippage <= 100;

  const benchmark = trpc.backtesting.benchmark.useMutation();
  useEffect(() => { benchmark.reset(); }, [
    symbol, interval, startDate, endDate, startingCapital,
    fastEmaPeriod, slowEmaPeriod, riskBps, stopLossBps, takeProfitBps, feeBps, slippageBps, allowShort,
  ]);

  const run = () => {
    if (!rangeValid || !configValid || !auth.data) return;
    benchmark.mutate({
      symbol: symbol.trim().toUpperCase(), interval, startTime, endTime,
      startingCapital: capital, riskBps: risk, stopLossBps: stop, takeProfitBps: target,
      feeBps: fee, slippageBps: slippage, fastEmaPeriod: fast, slowEmaPeriod: slow, allowShort,
    });
  };

  if (OFFLINE_MODE) {
    return (
      <section className="panel strategy-benchmark-panel" id="strategy-benchmark">
        <div className="benchmark-heading"><div><div className="eyebrow">STRATEGY BENCHMARK</div><h2>Сравнение стратегии с рынком</h2></div><span className="benchmark-tag">OFFLINE APK</span></div>
        <p className="benchmark-note">Автономная Android-сборка не подключается к серверному историческому хранилищу. Сравнение доступно в серверной версии.</p>
      </section>
    );
  }

  return (
    <section className="panel strategy-benchmark-panel" id="strategy-benchmark" aria-labelledby="strategy-benchmark-title">
      <div className="benchmark-heading">
        <div><div className="eyebrow">STRATEGY BENCHMARK & COMPARATIVE ANALYTICS</div><h2 id="strategy-benchmark-title">Сравнение стратегии с контрольными моделями</h2><p>EMA Crossover против Buy & Hold и контрольного сохранения капитала на одном периоде.</p></div>
        <span className="benchmark-tag"><ShieldCheck size={13} /> RESEARCH ONLY</span>
      </div>
      <div className="benchmark-safety"><ShieldCheck size={14} /> Все модели используют один набор закрытых свечей и одинаковые базовые комиссии и проскальзывание. Сравнение не создаёт сигналов или ордеров.</div>

      {auth.isLoading && <p className="benchmark-note">Проверка авторизованной сессии…</p>}
      {auth.isError && <p className="benchmark-error">Не удалось проверить авторизацию. Запрос не запускался.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && <p className="benchmark-note">Для доступа к историческим данным требуется авторизованная сессия.</p>}

      {auth.data && (
        <>
          <div className="benchmark-controls">
            <label>Символ<input value={symbol} maxLength={20} onChange={event => setSymbol(event.target.value.toUpperCase())} /></label>
            <label>Интервал<select value={interval} onChange={event => setInterval(event.target.value as (typeof MARKET_DATA_INTERVALS)[number])}>
              {INTERVAL_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Начало UTC<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <label>Конец UTC<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
          </div>
          <div className="benchmark-settings">
            <label>Стартовый капитал<input type="number" min="1" max="1000000000" step="0.01" value={startingCapital} onChange={event => setStartingCapital(event.target.value)} /></label>
            <label>Быстрая EMA<input type="number" min="2" max="100" value={fastEmaPeriod} onChange={event => setFastEmaPeriod(event.target.value)} /></label>
            <label>Медленная EMA<input type="number" min="3" max="300" value={slowEmaPeriod} onChange={event => setSlowEmaPeriod(event.target.value)} /></label>
            <label>Риск / сделка, bps<input type="number" min="1" max="1000" value={riskBps} onChange={event => setRiskBps(event.target.value)} /></label>
            <label>Stop Loss, bps<input type="number" min="10" max="5000" value={stopLossBps} onChange={event => setStopLossBps(event.target.value)} /></label>
            <label>Take Profit, bps<input type="number" min="10" max="10000" value={takeProfitBps} onChange={event => setTakeProfitBps(event.target.value)} /></label>
            <label>Комиссия, bps<input type="number" min="0" max="100" value={feeBps} onChange={event => setFeeBps(event.target.value)} /></label>
            <label>Проскальзывание, bps<input type="number" min="0" max="100" value={slippageBps} onChange={event => setSlippageBps(event.target.value)} /></label>
          </div>
          <div className="benchmark-extra">
            <label><input type="checkbox" checked={allowShort} onChange={event => setAllowShort(event.target.checked)} /> Разрешить SHORT в EMA-модели</label>
            <span>Buy & Hold всегда LONG; плечо не используется</span>
          </div>
          {!rangeValid && <p className="benchmark-error">Укажите символ и корректный диапазон до 366 дней.</p>}
          {!configValid && <p className="benchmark-error"><AlertTriangle size={13} /> Проверьте капитал, EMA, риск, стоп, цель и затраты.</p>}
          <button type="button" className="benchmark-run" onClick={run} disabled={!rangeValid || !configValid || !auth.data || benchmark.isPending}>
            <Play size={14} /> {benchmark.isPending ? "Выполняется сравнение…" : "Запустить сравнительный анализ"}
          </button>
          <p className="benchmark-note">Перед запуском загрузите выбранный период через «История и Backtest». Модуль читает только сохранённые свечи.</p>
          {benchmark.error && <p className="benchmark-error">{safeError(benchmark.error)}</p>}
          {benchmark.data && (
            <div className="benchmark-results">
              <div className="benchmark-result-title"><strong>Сравнение моделей</strong><span>{benchmark.data.symbol} · {benchmark.data.candlesProcessed.toLocaleString("ru-RU")} свечей</span></div>
              <div className="benchmark-kpis">
                <div><span>Преимущество EMA к Buy & Hold 1x</span><strong>{pct(benchmark.data.comparison.excessReturnVsBuyAndHoldOneXPctPoints)}</strong></div>
                <div><span>Преимущество EMA к риск-сопоставимому B&H</span><strong>{pct(benchmark.data.comparison.excessReturnVsRiskMatchedPctPoints)}</strong></div>
                <div><span>Разница просадки к Buy & Hold 1x</span><strong>{pct(benchmark.data.comparison.drawdownDifferenceVsBuyAndHoldOneXPctPoints)}</strong></div>
              </div>
              <div className="benchmark-table-wrap">
                <table>
                  <thead><tr><th>Модель</th><th>Итоговый капитал</th><th>Чистый PnL</th><th>Доходность</th><th>Макс. просадка</th><th>Годовая волатильность</th><th>Sharpe</th><th>Sortino</th><th>Доходность / DD</th><th>Комиссии</th><th>Сделок</th></tr></thead>
                  <tbody>
                    <tr><td>EMA Crossover</td><td>{money(benchmark.data.strategyMetrics.finalEquity)}</td><td>{money(benchmark.data.strategyMetrics.netProfit)}</td><td>{pct(benchmark.data.strategyMetrics.totalReturnPct)}</td><td>{pct(benchmark.data.strategyMetrics.maxDrawdownPct)}</td><td>{pct(benchmark.data.strategyMetrics.annualizedVolatilityPct ?? NaN)}</td><td>{ratio(benchmark.data.strategyMetrics.sharpeRatio)}</td><td>{ratio(benchmark.data.strategyMetrics.sortinoRatio)}</td><td>{ratio(benchmark.data.strategyMetrics.returnToMaxDrawdown)}</td><td>{money(benchmark.data.strategyMetrics.feesPaid)}</td><td>{benchmark.data.strategyMetrics.totalTrades}</td></tr>
                    <tr><td>Buy & Hold · 1x</td><td>{money(benchmark.data.benchmarks.buyAndHoldOneX.finalEquity)}</td><td>{money(benchmark.data.benchmarks.buyAndHoldOneX.netProfit)}</td><td>{pct(benchmark.data.benchmarks.buyAndHoldOneX.totalReturnPct)}</td><td>{pct(benchmark.data.benchmarks.buyAndHoldOneX.maxDrawdownPct)}</td><td>{pct(benchmark.data.benchmarks.buyAndHoldOneX.annualizedVolatilityPct ?? NaN)}</td><td>{ratio(benchmark.data.benchmarks.buyAndHoldOneX.sharpeRatio)}</td><td>{ratio(benchmark.data.benchmarks.buyAndHoldOneX.sortinoRatio)}</td><td>{ratio(benchmark.data.benchmarks.buyAndHoldOneX.returnToMaxDrawdown)}</td><td>{money(benchmark.data.benchmarks.buyAndHoldOneX.feesPaid)}</td><td>{benchmark.data.benchmarks.buyAndHoldOneX.totalTrades}</td></tr>
                    <tr><td>Buy & Hold · risk-matched</td><td>{money(benchmark.data.benchmarks.buyAndHoldRiskMatched.finalEquity)}</td><td>{money(benchmark.data.benchmarks.buyAndHoldRiskMatched.netProfit)}</td><td>{pct(benchmark.data.benchmarks.buyAndHoldRiskMatched.totalReturnPct)}</td><td>{pct(benchmark.data.benchmarks.buyAndHoldRiskMatched.maxDrawdownPct)}</td><td>{pct(benchmark.data.benchmarks.buyAndHoldRiskMatched.annualizedVolatilityPct ?? NaN)}</td><td>{ratio(benchmark.data.benchmarks.buyAndHoldRiskMatched.sharpeRatio)}</td><td>{ratio(benchmark.data.benchmarks.buyAndHoldRiskMatched.sortinoRatio)}</td><td>{ratio(benchmark.data.benchmarks.buyAndHoldRiskMatched.returnToMaxDrawdown)}</td><td>{money(benchmark.data.benchmarks.buyAndHoldRiskMatched.feesPaid)}</td><td>{benchmark.data.benchmarks.buyAndHoldRiskMatched.totalTrades}</td></tr>
                    <tr><td>Cash control</td><td>{money(benchmark.data.benchmarks.cashControl.finalEquity)}</td><td>{money(benchmark.data.benchmarks.cashControl.netProfit)}</td><td>{pct(benchmark.data.benchmarks.cashControl.totalReturnPct)}</td><td>{pct(benchmark.data.benchmarks.cashControl.maxDrawdownPct)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>{money(benchmark.data.benchmarks.cashControl.feesPaid)}</td><td>0</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="benchmark-note">Sharpe, Sortino и годовая волатильность рассчитываются по кривой marked-to-market equity; требуется минимум 30 интервальных доходностей. Безрисковая ставка и downside target — 0%. Для короткой истории показатели скрываются.</p>
              <div className="benchmark-result-foot">
                EMA vs Buy & Hold 1x: {benchmark.data.comparison.outperformedBuyAndHoldOneX ? "выше по доходности" : "не выше по доходности"} ·
                risk-matched: {benchmark.data.comparison.outperformedRiskMatchedBuyAndHold ? "выше" : "не выше"} ·
                cash: {benchmark.data.comparison.outperformedCash ? "выше" : "не выше"}
                <br />
                Run ID: {benchmark.data.runId} · SHA-256: {benchmark.data.dataDigest.slice(0, 16)}… · executionEligible=false
              </div>
              <details className="benchmark-assumptions"><summary>Методика и ограничения</summary><ul>{benchmark.data.assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
