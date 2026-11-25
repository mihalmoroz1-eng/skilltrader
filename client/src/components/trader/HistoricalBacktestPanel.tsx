import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";
import "./HistoricalBacktestPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const INTERVAL_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type MarketInterval = (typeof MARKET_DATA_INTERVALS)[number];

function utcDateInput(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
function money(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}
function safeError(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "Требуется авторизованная сессия.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит запросов достигнут. Подождите перед повтором.";
  if (code === "BAD_REQUEST") return "Проверьте символ, интервал и временной диапазон.";
  if (code === "SERVICE_UNAVAILABLE") return "Историческое хранилище временно недоступно.";
  return "Операция не завершена. Проверьте доступность базы данных и источника.";
}

export default function HistoricalBacktestPanel() {
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<MarketInterval>("1h");
  const [startDate, setStartDate] = useState(() => utcDateInput(30));
  const [endDate, setEndDate] = useState(() => utcDateInput());
  const [queryEnabled, setQueryEnabled] = useState(false);
  const [startingCapital, setStartingCapital] = useState("10000");
  const [riskBps, setRiskBps] = useState("50");
  const [stopLossBps, setStopLossBps] = useState("200");
  const [takeProfitBps, setTakeProfitBps] = useState("400");
  const [allowShort, setAllowShort] = useState(false);
  const [strategy, setStrategy] = useState<"ema_crossover" | "rsi_mean_reversion" | "macd_momentum">("ema_crossover");
  const [rsiPeriod, setRsiPeriod] = useState("14");
  const [rsiOversoldLevel, setRsiOversoldLevel] = useState("30");
  const [rsiOverboughtLevel, setRsiOverboughtLevel] = useState("70");
  const [macdFastPeriod, setMacdFastPeriod] = useState("12");
  const [macdSlowPeriod, setMacdSlowPeriod] = useState("26");
  const [macdSignalPeriod, setMacdSignalPeriod] = useState("9");

  const startTime = Date.parse(`${startDate}T00:00:00.000Z`);
  const endTime = Date.parse(`${endDate}T23:59:59.999Z`);
  const rangeValid = Number.isFinite(startTime) && Number.isFinite(endTime) &&
    endTime > startTime && endTime - startTime <= 366 * 86_400_000 &&
    /^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase());
  const rangeInput = useMemo(() => ({
    symbol: symbol.trim().toUpperCase(),
    interval,
    startTime: Number.isFinite(startTime) ? startTime : 0,
    endTime: Number.isFinite(endTime) ? endTime : 0,
    limit: 50_001,
  }), [symbol, interval, startTime, endTime]);

  const candles = trpc.historicalData.candles.useQuery(rangeInput, {
    enabled: !OFFLINE_MODE && !!auth.data && queryEnabled && rangeValid,
    retry: false, refetchOnWindowFocus: false, staleTime: 0,
  });
  const ingest = trpc.historicalData.ingest.useMutation({
    onSuccess: () => setQueryEnabled(true),
  });
  const backtest = trpc.backtesting.run.useMutation();

  useEffect(() => {
    setQueryEnabled(false);
    ingest.reset();
    backtest.reset();
  }, [symbol, interval, startDate, endDate, strategy, rsiPeriod, rsiOversoldLevel, rsiOverboughtLevel, macdFastPeriod, macdSlowPeriod, macdSignalPeriod, macdFastPeriod, macdSlowPeriod, macdSignalPeriod]);

  const loadedCandles = candles.data ?? [];
  const canBacktest = rangeValid && loadedCandles.length > 0 && loadedCandles.length <= 50_000 &&
    Number.isFinite(Number(startingCapital)) && Number(startingCapital) >= 1 && Number(startingCapital) <= 1_000_000_000 &&
    Number.isInteger(Number(riskBps)) && Number(riskBps) >= 1 && Number(riskBps) <= 1_000 &&
    Number.isInteger(Number(stopLossBps)) && Number(stopLossBps) >= 10 && Number(stopLossBps) <= 5_000 &&
    Number.isInteger(Number(takeProfitBps)) && Number(takeProfitBps) >= 10 && Number(takeProfitBps) <= 10_000 &&
    Number(riskBps) < Number(stopLossBps) &&
    (strategy !== "macd_momentum" || (Number.isInteger(Number(macdFastPeriod)) && Number(macdFastPeriod) >= 2 && Number(macdFastPeriod) <= 100 && Number.isInteger(Number(macdSlowPeriod)) && Number(macdSlowPeriod) > Number(macdFastPeriod) && Number(macdSlowPeriod) <= 300 && Number.isInteger(Number(macdSignalPeriod)) && Number(macdSignalPeriod) >= 2 && Number(macdSignalPeriod) <= 100)) &&
    (strategy !== "rsi_mean_reversion" || (Number.isInteger(Number(rsiPeriod)) && Number(rsiPeriod) >= 2 && Number(rsiPeriod) <= 100 &&
      Number.isInteger(Number(rsiOversoldLevel)) && Number(rsiOversoldLevel) >= 5 && Number(rsiOversoldLevel) <= 45 &&
      Number.isInteger(Number(rsiOverboughtLevel)) && Number(rsiOverboughtLevel) >= 55 && Number(rsiOverboughtLevel) <= 95 &&
      Number(rsiOverboughtLevel) - Number(rsiOversoldLevel) >= 10));

  const startIngestion = () => {
    setQueryEnabled(false);
    ingest.mutate({
      symbol: symbol.trim().toUpperCase(), interval, startTime, endTime, pageLimit: 1000,
    });
  };
  const loadStoredCandles = () => {
    if (rangeValid) setQueryEnabled(true);
  };
  const runBacktest = () => {
    if (!canBacktest) return;
    backtest.mutate({
      symbol: symbol.trim().toUpperCase(), interval, startTime, endTime,
      startingCapital: Number(startingCapital), riskBps: Number(riskBps),
      stopLossBps: Number(stopLossBps), takeProfitBps: Number(takeProfitBps),
      feeBps: 5, slippageBps: 5, fastEmaPeriod: 20, slowEmaPeriod: 50, allowShort,
      strategy, rsiPeriod: Number(rsiPeriod), rsiOversoldLevel: Number(rsiOversoldLevel), rsiOverboughtLevel: Number(rsiOverboughtLevel),
      macdFastPeriod: Number(macdFastPeriod), macdSlowPeriod: Number(macdSlowPeriod), macdSignalPeriod: Number(macdSignalPeriod),
    });
  };

  if (OFFLINE_MODE) {
    return (
      <section className="panel history-backtest-panel" id="historical-backtesting">
        <div className="history-panel-heading"><div><div className="eyebrow">HISTORICAL DATA · BACKTEST</div><h2>История рынка и тестирование</h2></div><span className="history-mode-tag">OFFLINE APK</span></div>
        <p className="history-note">Серверное историческое хранилище недоступно в автономной Android-сборке. Демо-симуляция работает отдельно.</p>
      </section>
    );
  }

  return (
    <section className="panel history-backtest-panel" id="historical-backtesting" aria-labelledby="history-backtest-title">
      <div className="history-panel-heading">
        <div><div className="eyebrow">HISTORICAL DATA · BACKTEST</div><h2 id="history-backtest-title">Исторические данные и тестирование</h2><p>Публичные свечи Binance Spot → хранилище → детерминированный backtest.</p></div>
        <span className="history-mode-tag"><ShieldCheck size={13} /> RESEARCH ONLY</span>
      </div>
      <div className="history-safety-note"><ShieldCheck size={14} /> Результаты предназначены для исследования. Они не создают сигналы или ордера и не разрешают LIVE-исполнение.</div>

      {auth.isLoading && <p className="history-note">Проверка авторизованной сессии…</p>}
      {auth.isError && <p className="history-error">Не удалось проверить авторизацию. Запросы к источнику не запускались.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && <p className="history-note">Для исторического хранилища требуется авторизованная сессия.</p>}

      {auth.data && (
        <>
          <div className="history-controls">
            <label>Символ
              <input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} maxLength={20} placeholder="BTCUSDT" />
            </label>
            <label>Интервал
              <select value={interval} onChange={event => setInterval(event.target.value as MarketInterval)}>
                {INTERVAL_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>Начало (UTC)<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <label>Конец (UTC)<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
          </div>
          {!rangeValid && <p className="history-error">Укажите корректный диапазон до 366 дней и символ из 2–20 латинских букв или цифр.</p>}
          <div className="history-actions">
            <button type="button" onClick={startIngestion} disabled={!rangeValid || ingest.isPending}>
              <Database size={14} /> {ingest.isPending ? "Загрузка страниц…" : "Загрузить Binance в хранилище"}
            </button>
            <button type="button" className="history-secondary" onClick={loadStoredCandles} disabled={!rangeValid || candles.isFetching}>
              <RefreshCw size={14} /> Читать из хранилища
            </button>
          </div>
          {ingest.error && <p className="history-error">{safeError(ingest.error)}</p>}
          {ingest.data && (
            <div className="history-ingest-result" role="status">
              <strong>Загрузка завершена · {ingest.data.candlesStored.toLocaleString("ru-RU")} свечей</strong>
              <span>{ingest.data.pagesFetched} страниц · источник {ingest.data.source} · пропусков: {ingest.data.quality.gaps.length}</span>
              <span>{ingest.data.quality.complete ? "Диапазон прошёл проверку полноты" : "Диапазон неполный: проверьте границы и пропуски"}</span>
            </div>
          )}
          {candles.isFetching && <p className="history-note">Чтение исторических свечей…</p>}
          {candles.error && <p className="history-error">{safeError(candles.error)}</p>}
          {candles.data && (
            <div className="history-stored-result">
              <div><strong>{loadedCandles.length.toLocaleString("ru-RU")}</strong><span>свечей в хранилище</span></div>
              <div><strong>{loadedCandles.length > 0 ? new Date(loadedCandles[0].openTime).toLocaleDateString("ru-RU") : "—"}</strong><span>первая свеча</span></div>
              <div><strong>{loadedCandles.length > 0 ? new Date(loadedCandles[loadedCandles.length - 1].openTime).toLocaleDateString("ru-RU") : "—"}</strong><span>последняя свеча</span></div>
              {loadedCandles.length > 50_000 && <span className="history-warning"><AlertTriangle size={13} /> Свыше лимита backtest (50 000)</span>}
            </div>
          )}

          <div className="history-backtest-divider" />
          <div className="history-backtest-subheading"><div><div className="eyebrow">STRATEGY ENGINE</div><h3>Параметры backtest</h3></div><span>1x exposure cap</span></div>
          <div className="history-backtest-settings">
            <label>Стратегия<select value={strategy} onChange={event => setStrategy(event.target.value as "ema_crossover" | "rsi_mean_reversion" | "macd_momentum")}>
              <option value="ema_crossover">EMA Crossover</option>
              <option value="rsi_mean_reversion">RSI Mean Reversion</option>
              <option value="macd_momentum">MACD Momentum</option>
            </select></label>
            {strategy === "rsi_mean_reversion" && <>
              <label>RSI Period<input type="number" min="2" max="100" value={rsiPeriod} onChange={event => setRsiPeriod(event.target.value)} /></label>
              <label>RSI Oversold<input type="number" min="5" max="45" value={rsiOversoldLevel} onChange={event => setRsiOversoldLevel(event.target.value)} /></label>
              <label>RSI Overbought<input type="number" min="55" max="95" value={rsiOverboughtLevel} onChange={event => setRsiOverboughtLevel(event.target.value)} /></label>
            </>}
            {strategy === "macd_momentum" && <>
              <label>MACD Fast<input type="number" min="2" max="100" value={macdFastPeriod} onChange={event => setMacdFastPeriod(event.target.value)} /></label>
              <label>MACD Slow<input type="number" min="3" max="300" value={macdSlowPeriod} onChange={event => setMacdSlowPeriod(event.target.value)} /></label>
              <label>MACD Signal<input type="number" min="2" max="100" value={macdSignalPeriod} onChange={event => setMacdSignalPeriod(event.target.value)} /></label>
            </>}
            <label>Стартовый капитал, USDT<input type="number" min="1" max="1000000000" step="0.01" value={startingCapital} onChange={event => setStartingCapital(event.target.value)} /></label>
            <label>Риск, bps<input type="number" min="1" max="1000" value={riskBps} onChange={event => setRiskBps(event.target.value)} /></label>
            <label>Stop Loss, bps<input type="number" min="10" max="5000" value={stopLossBps} onChange={event => setStopLossBps(event.target.value)} /></label>
            <label>Take Profit, bps<input type="number" min="10" max="10000" value={takeProfitBps} onChange={event => setTakeProfitBps(event.target.value)} /></label>
            <label className="history-checkbox"><input type="checkbox" checked={allowShort} onChange={event => setAllowShort(event.target.checked)} /> Разрешить SHORT</label>
          </div>
          <button type="button" className="history-backtest-run" onClick={runBacktest} disabled={!canBacktest || backtest.isPending}>
            <Play size={14} /> {backtest.isPending ? "Тестирование…" : "Запустить исторический backtest"}
          </button>
          {!candles.data && <p className="history-note">Сначала загрузите свечи или прочитайте ранее сохранённую историю.</p>}
          {candles.data && loadedCandles.length === 0 && <p className="history-note">В выбранном диапазоне свечи не найдены.</p>}
          {backtest.error && <p className="history-error">{safeError(backtest.error)}</p>}
          {backtest.data && (
            <div className="history-backtest-result">
              <div className="history-result-heading"><strong>Результат · {backtest.data.strategy === "rsi_mean_reversion" ? "RSI Mean Reversion" : backtest.data.strategy === "macd_momentum" ? "MACD Momentum" : "EMA Crossover"}</strong><span>{backtest.data.candlesProcessed.toLocaleString("ru-RU")} свечей · {backtest.data.trades.length} сделок</span></div>
              <div className="history-metrics">
                <div><span>Итоговый капитал</span><strong>{money(backtest.data.metrics.finalEquity)} USDT</strong></div>
                <div><span>Чистая прибыль</span><strong className={backtest.data.metrics.netProfit >= 0 ? "is-positive" : "is-negative"}>{money(backtest.data.metrics.netProfit)} USDT</strong></div>
                <div><span>Доходность</span><strong>{money(backtest.data.metrics.totalReturnPct)}%</strong></div>
                <div><span>Макс. просадка</span><strong>{money(backtest.data.metrics.maxDrawdownPct)}%</strong></div>
                <div><span>Win rate</span><strong>{money(backtest.data.metrics.winRatePct)}%</strong></div>
                <div><span>Комиссии</span><strong>{money(backtest.data.metrics.feesPaid)} USDT</strong></div>
              </div>
              <div className="history-result-foot">Run ID: {backtest.data.runId} · executionEligible=false · плечо не моделируется</div>
              <details className="history-assumptions"><summary>Допущения модели</summary><ul>{backtest.data.assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
