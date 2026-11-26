import { useState } from "react";
import { Activity, AlertTriangle, BrainCircuit, RefreshCw, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MARKET_DATA_INTERVALS } from "@shared/marketData";
import "./FuturesResearchPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
type MarketInterval = (typeof MARKET_DATA_INTERVALS)[number];

const ASSESSMENT_LABELS: Record<string, string> = {
  constructive: "Согласованный конструктивный контекст",
  mixed: "Смешанный контекст",
  cautionary: "Контекст требует осторожности",
  insufficient: "Недостаточно данных для оценки",
};
const EVIDENCE_LABELS: Record<string, string> = {
  spot_trend_bullish: "Spot: восходящая структура",
  spot_trend_bearish: "Spot: нисходящая структура",
  spot_price_above_ema20: "Цена Spot выше EMA 20",
  spot_price_below_ema20: "Цена Spot ниже EMA 20",
  macd_positive: "MACD положительный",
  macd_negative: "MACD отрицательный",
  rsi_extreme: "RSI в крайней зоне",
  atr_low: "Низкая относительная волатильность",
  atr_normal: "Обычная относительная волатильность",
  atr_high: "Повышенная относительная волатильность",
  spread_tight: "Узкий спред",
  spread_normal: "Обычный спред",
  spread_wide: "Широкий спред",
  bid_depth_dominant: "Глубина bid преобладает",
  ask_depth_dominant: "Глубина ask преобладает",
  book_balanced: "Стакан относительно сбалансирован",
  funding_positive: "Положительный funding",
  funding_negative: "Отрицательный funding",
  funding_neutral: "Нейтральный funding",
  funding_crowded_long: "Признак переполненности long",
  funding_crowded_short: "Признак переполненности short",
  basis_positive: "Положительный mark/index basis",
  basis_negative: "Отрицательный mark/index basis",
  basis_neutral: "Нейтральный mark/index basis",
  open_interest_present: "Open interest доступен",
};
const RISK_LABELS: Record<string, string> = {
  thin_liquidity: "Тонкая ликвидность",
  funding_crowding_long: "Скопление long по funding",
  funding_crowding_short: "Скопление short по funding",
  spot_futures_divergence: "Расхождение Spot и Futures",
  elevated_volatility: "Повышенная волатильность",
};
function safeError(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "Требуется авторизованная сессия.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит запросов достигнут. Подождите перед повтором.";
  if (code === "PRECONDITION_FAILED") return "Источники не прошли проверку свежести или качества.";
  if (code === "BAD_GATEWAY") return "Источник вернул данные, не прошедшие проверку.";
  if (code === "SERVICE_UNAVAILABLE") return "Публичный источник или AI-сервис временно недоступен.";
  return "Исследование не завершено.";
}
function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
}
function time(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : new Date(value).toLocaleString("ru-RU");
}

export default function FuturesResearchPanel() {
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  });
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<MarketInterval>("15m");
  const [futuresEnabled, setFuturesEnabled] = useState(false);
  const [requestedNotionalUsd, setRequestedNotionalUsd] = useState("1000");
  const futures = trpc.futuresIntelligence.analyze.useQuery(
    { symbol: symbol.trim().toUpperCase(), depthLimit: 100 },
    { enabled: !OFFLINE_MODE && !!auth.data && futuresEnabled, retry: false, refetchOnWindowFocus: false, staleTime: 0 },
  );
  const research = trpc.researchAgent.analyze.useMutation();
  const executionSimulation = trpc.futuresIntelligence.simulateExecution.useMutation();

  if (OFFLINE_MODE) {
    return (
      <section className="panel futures-research-panel" id="futures-research">
        <div className="futures-panel-heading"><div><div className="eyebrow">FUTURES · RESEARCH AGENT</div><h2>Контекст фьючерсов и исследование</h2></div><span className="futures-mode-tag">OFFLINE APK</span></div>
        <p className="futures-note">Сетевые источники отключены в автономной Android-сборке. Локальные демо-инструменты работают отдельно.</p>
      </section>
    );
  }

  const researchData = research.data;
  const futuresData = futures.data;
  const depth25 = futuresData?.depth.find(item => item.bandBps === 25);

  return (
    <section className="panel futures-research-panel" id="futures-research" aria-labelledby="futures-research-title">
      <div className="futures-panel-heading">
        <div><div className="eyebrow">FUTURES · RESEARCH AGENT</div><h2 id="futures-research-title">Ликвидность и исследовательский контекст</h2><p>Публичные USD-M данные и качественное резюме без торгового направления.</p></div>
        <span className="futures-mode-tag"><ShieldCheck size={13} /> ADVISORY ONLY</span>
      </div>
      <div className="futures-safety-note"><ShieldCheck size={14} /> Ни один из этих модулей не выдаёт ордера, размер позиции или разрешение на исполнение.</div>

      {auth.isLoading && <p className="futures-note">Проверка авторизованной сессии…</p>}
      {auth.isError && <p className="futures-error">Не удалось проверить авторизацию.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && <p className="futures-note">Для защищённого исследовательского запроса требуется вход.</p>}

      {auth.data && (
        <>
          <div className="futures-controls">
            <label>Символ<input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} maxLength={20} /></label>
            <label>Размер заявки, USDT<input inputMode="decimal" value={requestedNotionalUsd} onChange={event => setRequestedNotionalUsd(event.target.value)} maxLength={12} /></label>
            <label>Spot интервал
              <select value={interval} onChange={event => setInterval(event.target.value as MarketInterval)}>
                {(["5m", "15m", "30m", "1h", "4h"] as const).map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <div className="futures-actions">
            <button type="button" onClick={() => { if (futuresEnabled) void futures.refetch(); else setFuturesEnabled(true); }} disabled={!/^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase()) || futures.isFetching}>
              <RefreshCw size={14} /> {futures.isFetching ? "Загрузка…" : "Получить Futures контекст"}
            </button>
            <button type="button" className="futures-research-button" onClick={() => research.mutate({ symbol: symbol.trim().toUpperCase(), interval, limit: 96 })} disabled={!/^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase()) || research.isPending}>
              <BrainCircuit size={14} /> {research.isPending ? "Исследование…" : "Запустить Research Agent"}
            </button>
            <button type="button" onClick={() => executionSimulation.mutate({
              symbol: symbol.trim().toUpperCase(), requestedNotionalUsd: Number(requestedNotionalUsd), depthLimit: 100,
            })} disabled={!/^[A-Z0-9]{2,20}$/.test(symbol.trim().toUpperCase()) || !Number.isFinite(Number(requestedNotionalUsd)) || Number(requestedNotionalUsd) < 1 || Number(requestedNotionalUsd) > 10_000_000 || executionSimulation.isPending}>
              <Activity size={14} /> {executionSimulation.isPending ? "Расчёт…" : "Симулировать по стакану"}
            </button>
          </div>
          {futures.error && <p className="futures-error">{safeError(futures.error)}</p>}
          {executionSimulation.error && <p className="futures-error">{safeError(executionSimulation.error)}</p>}
          {futuresData && (
            <div className="futures-context">
              <div className="futures-context-heading"><strong>{futuresData.symbol} · Binance USD-M Futures</strong><span>Получено: {time(futuresData.fetchedAt)}</span></div>
              <div className="futures-metrics">
                <div><span>Спред</span><strong>{number(futuresData.orderBook.spreadBps)} bps</strong></div>
                <div><span>Ликвидность</span><strong>{futuresData.interpretation.liquidity}</strong></div>
                <div><span>Перекос стакана</span><strong>{futuresData.interpretation.bookBias}</strong></div>
                <div><span>Mark / Index</span><strong>{number(futuresData.futures.markIndexBasisBps)} bps</strong></div>
                <div><span>Funding</span><strong>{futuresData.futures.fundingRate}</strong></div>
                <div><span>Open Interest</span><strong>{futuresData.futures.openInterest}</strong></div>
              </div>
              {depth25 && <p className="futures-depth-line">Глубина ±25 bps: bid {number(depth25.bidNotional)} USDT · ask {number(depth25.askNotional)} USDT · imbalance {number(depth25.imbalance, 3)}</p>}
              {futuresData.warnings.length > 0 && <ul className="futures-warning-list">{futuresData.warnings.map(item => <li key={item}>{item}</li>)}</ul>}
              <div className="futures-result-foot">Источник: {futuresData.source} · executionEligible=false</div>
            </div>
          )}
          {executionSimulation.data &&
            executionSimulation.data.symbol === symbol.trim().toUpperCase() &&
            executionSimulation.data.requestedNotionalUsd === Number(requestedNotionalUsd) && (
              <div className="futures-context">
                <div className="futures-context-heading"><strong>Liquidity-Aware Execution Simulation · {executionSimulation.data.symbol}</strong><span>Снимок: {time(executionSimulation.data.snapshotFetchedAt)} · возраст {number(executionSimulation.data.snapshotAgeMs, 0)} ms</span></div>
                <p className="futures-note">Текущая оценка по видимым уровням стакана. Это не исторический replay сделок стратегии.</p>
                <div className="futures-metrics">
                  {[executionSimulation.data.buy, executionSimulation.data.sell].map(item => (
                    <div key={item.side}>
                      <span>{item.side === "BUY" ? "Покупка · проход по ask" : "Продажа · проход по bid"}</span>
                      <strong>{item.fullyFilled ? "Полный объём доступен" : "Недостаточная глубина"}</strong>
                      <span>Исполнено: {number(item.fillRatioPct, 2)}%</span>
                      <span>Средняя цена: {number(item.averageFillPrice, 6)}</span>
                      <span>Издержка к mid: {number(item.totalMidShortfallBps, 3)} bps</span>
                      <span>Спред: {number(item.spreadCostBps, 3)} bps · impact: {number(item.depthImpactBps, 3)} bps</span>
                      <span>Уровней: {item.levelsConsumed} · доступно: {number(item.availableBookNotionalUsd)} USDT</span>
                    </div>
                  ))}
                </div>
                <ul className="futures-warning-list">{executionSimulation.data.assumptions.map(item => <li key={item}>{item}</li>)}</ul>
                <div className="futures-result-foot">executionEligible=false · exchangeOrderSent=false</div>
              </div>
            )}
          {research.error && <p className="futures-error">{safeError(research.error)}</p>}
          {researchData && (
            <div className="research-result">
              <div className="research-result-heading"><div><div className="eyebrow">RESEARCH AGENT</div><strong>{ASSESSMENT_LABELS[researchData.assessment] ?? researchData.assessment}</strong></div><span><Activity size={13} /> Только контекст</span></div>
              <div className="research-code-groups">
                <div><strong>Подтверждённые факты</strong><ul>{researchData.evidenceCodes.map(code => <li key={code}>{EVIDENCE_LABELS[code] ?? "Неизвестный код"}</li>)}</ul></div>
                <div><strong>Флаги риска</strong>{researchData.riskFlags.length ? <ul>{researchData.riskFlags.map(code => <li key={code}>{RISK_LABELS[code] ?? "Неизвестный флаг"}</li>)}</ul> : <p>Разрешённые флаги риска не обнаружены.</p>}</div>
              </div>
              <div className="research-provenance">
                <span>Spot: {time(researchData.provenance.spotFetchedAt)}</span>
                <span>Futures: {time(researchData.provenance.futuresFetchedAt)}</span>
                <span>Модель: {researchData.provenance.model}</span>
                <span>Digest: {researchData.provenance.researchDigest.slice(0, 16)}…</span>
              </div>
              <ul className="research-warning-list">{researchData.warnings.map(item => <li key={item}>{item}</li>)}</ul>
              <div className="futures-result-foot">executionEligible=false · торговое направление и рекомендация не формируются</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
