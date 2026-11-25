import { useState } from "react";
import { Activity, AlertTriangle, BarChart3, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";
import Portfolio3DMap from "./Portfolio3DMap";
import "./PortfolioIntelligencePanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const INTERVAL_OPTIONS = ["5m", "15m", "1h", "4h", "1d"] as const;
function utcDateInput(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
function pct(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2) + "%";
}
function money(value: string | null): string {
  if (value == null) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}
function safeError(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "Требуется авторизованная сессия.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит запросов достигнут. Повторите позже.";
  if (code === "BAD_REQUEST") return "Проверьте символы, период и наличие сохранённой истории.";
  if (code === "SERVICE_UNAVAILABLE") return "История или публичные mark-price данные временно недоступны.";
  return "Анализ не завершён. Проверьте доступность сервисов.";
}
function intervalMillis(value: string): number {
  const intervals: Record<string, number> = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000, "1M": 2_419_200_000,
  };
  return intervals[value] ?? 0;
}

export default function PortfolioIntelligencePanel() {
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  const [symbolsText, setSymbolsText] = useState("BTCUSDT,ETHUSDT");
  const [interval, setInterval] = useState<(typeof MARKET_DATA_INTERVALS)[number]>("1h");
  const [startDate, setStartDate] = useState(() => utcDateInput(120));
  const [endDate, setEndDate] = useState(() => utcDateInput());
  const analysis = trpc.paper.intelligence.useMutation();
  const symbols = [...new Set(symbolsText.split(",").map(value => value.trim().toUpperCase()).filter(Boolean))];
  const startTime = Date.parse(startDate + "T00:00:00.000Z");
  const endTime = Date.parse(endDate + "T23:59:59.999Z");
  const rangeValid = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime &&
    endTime - startTime <= 366 * 86_400_000 && Math.ceil((endTime - startTime) / intervalMillis(interval)) <= 5_000;
  const symbolsValid = symbols.length >= 2 && symbols.length <= 10 && symbols.every(symbol => /^[A-Z0-9]{2,20}$/.test(symbol));

  function run() {
    if (!auth.data || !symbolsValid || !rangeValid) return;
    analysis.mutate({ symbols, interval, startTime, endTime });
  }
  if (OFFLINE_MODE) {
    return (
      <section className="panel portfolio-intelligence-panel" id="portfolio-intelligence">
        <div className="portfolio-heading"><div><div className="eyebrow">PORTFOLIO INTELLIGENCE</div><h2>Портфель и корреляции</h2></div><span className="portfolio-tag">OFFLINE APK</span></div>
        <p className="portfolio-note">Автономная Android-сборка не подключается к серверному PAPER-портфелю и историческому хранилищу.</p>
      </section>
    );
  }
  const result = analysis.data;
  return (
    <section className="panel portfolio-intelligence-panel" id="portfolio-intelligence" aria-labelledby="portfolio-intelligence-title">
      <div className="portfolio-heading">
        <div><div className="eyebrow">PORTFOLIO INTELLIGENCE & CORRELATION</div><h2 id="portfolio-intelligence-title">Портфель, корреляции и стресс-сценарии</h2><p>Доходности активов, текущая PAPER-экспозиция и оценка рыночного шока.</p></div>
        <span className="portfolio-tag"><ShieldCheck size={13} /> RESEARCH ONLY</span>
      </div>
      <div className="portfolio-safety"><ShieldCheck size={14} /> Модуль только читает сохранённую историю и виртуальные позиции. Account Risk Engine остаётся источником допуска и размера PAPER-позиции.</div>
      {auth.isLoading && <p className="portfolio-note">Проверка авторизованной сессии…</p>}
      {auth.isError && <p className="portfolio-error">Не удалось проверить авторизацию.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && <p className="portfolio-note">Для чтения PAPER-портфеля требуется авторизованная сессия.</p>}
      {auth.data && (
        <>
          <div className="portfolio-controls">
            <label>Символы через запятую<input value={symbolsText} onChange={event => setSymbolsText(event.target.value.toUpperCase())} placeholder="BTCUSDT,ETHUSDT,SOLUSDT" /></label>
            <label>Интервал<select value={interval} onChange={event => setInterval(event.target.value as (typeof MARKET_DATA_INTERVALS)[number])}>
              {INTERVAL_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Начало UTC<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <label>Конец UTC<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
          </div>
          {!symbolsValid && <p className="portfolio-error">Укажите от 2 до 10 уникальных символов.</p>}
          {!rangeValid && <p className="portfolio-error">Период — до 366 дней и не более 5 000 баров выбранного интервала.</p>}
          <button type="button" className="portfolio-run" onClick={run} disabled={!auth.data || !symbolsValid || !rangeValid || analysis.isPending}>
            <Play size={14} /> {analysis.isPending ? "Анализируем…" : "Рассчитать портфель и корреляции"}
          </button>
          <p className="portfolio-note">Загрузите историю для каждого символа через «История и Backtest». Открытые PAPER-позиции добавятся автоматически.</p>
          {analysis.error && <p className="portfolio-error">{safeError(analysis.error)}</p>}
          {result && (
            <div className="portfolio-results">
              <div className="portfolio-result-head"><strong>Результаты анализа</strong><span>{result.symbols.join(" · ")} · {result.interval}</span></div>
              <div className="portfolio-kpis">
                <div><span>Gross exposure</span><strong>{money(result.portfolio.grossExposure)}</strong></div>
                <div><span>Net directional</span><strong>{money(result.portfolio.netDirectionalExposure)}</strong></div>
                <div><span>Использование лимита</span><strong>{result.portfolio.grossExposureUtilizationBps == null ? "—" : pct(result.portfolio.grossExposureUtilizationBps / 100)}</strong></div>
                <div><span>Крупнейшая доля</span><strong>{pct(result.portfolio.concentration.largestWeightPct)}</strong></div>
              </div>
              <div className="portfolio-subtitle"><BarChart3 size={14} /> Корреляция доходностей по совпадающим свечам</div>
              <Portfolio3DMap correlations={result.correlations} exposure={result.portfolio.symbolExposure} />
              <div className="portfolio-table-wrap"><table>
                <thead><tr><th>Пара</th><th>Pearson</th><th>Наблюдений</th><th>Статус</th></tr></thead>
                <tbody>{result.correlations.map(pair => (
                  <tr key={pair.symbolA + pair.symbolB}><td>{pair.symbolA} / {pair.symbolB}</td><td>{pair.correlation == null ? "—" : pair.correlation.toFixed(3)}</td><td>{pair.observations}</td>
                    <td>{pair.status === "ready" ? "Готово" : pair.status === "insufficient_history" ? "Мало данных" : "Нулевая вариация"}</td></tr>
                ))}</tbody>
              </table></div>
              <div className="portfolio-subtitle"><Activity size={14} /> Экспозиция по активам</div>
              {result.portfolio.symbolExposure.length === 0
                ? <p className="portfolio-note">Нет открытых PAPER-позиций для распределения экспозиции.</p>
                : <div className="portfolio-table-wrap"><table><thead><tr><th>Символ</th><th>Gross</th><th>Net</th><th>Доля</th></tr></thead>
                  <tbody>{result.portfolio.symbolExposure.map(item => <tr key={item.symbol}><td>{item.symbol}</td><td>{money(item.grossNotional)}</td><td>{money(item.netNotional)}</td><td>{pct(item.weightPct)}</td></tr>)}</tbody></table></div>}
              <div className="portfolio-subtitle"><AlertTriangle size={14} /> Стресс-тест падения</div>
              {result.portfolio.stressScenarios
                ? <div className="portfolio-table-wrap"><table><thead><tr><th>Шок</th><th>Оценка PnL</th><th>Equity после шока</th><th>Состояние</th></tr></thead>
                  <tbody>{result.portfolio.stressScenarios.map(item => <tr key={item.shockBps}><td>{pct(item.shockBps / 100)}</td><td>{money(item.estimatedPnl)}</td><td>{money(item.stressedEquity)}</td><td>{item.equityDepleted ? "Equity исчерпана" : "Equity положительная"}</td></tr>)}</tbody></table></div>
                : <p className="portfolio-note">Стресс-расчёт скрыт: нет PAPER-счёта или актуальных mark-price данных.</p>}
              {result.warnings.map(warning => <p className="portfolio-warning" key={warning}><AlertTriangle size={13} />{warning}</p>)}
              <details className="portfolio-assumptions"><summary>Методика и ограничения</summary><ul>{result.assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>
              <div className="portfolio-result-foot">Run ID: {result.runId} · SHA-256: {result.dataDigest.slice(0, 16)}… · executionEligible=false · exchangeOrderSent=false</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
