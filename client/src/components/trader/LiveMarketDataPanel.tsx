import { useMemo, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./LiveMarketDataPanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const REQUEST = { symbol: "BTCUSDT", interval: "15m" as const, limit: 96 };

function formatDecimal(value: string): string {
  const [whole, fraction] = value.split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

function formatIndicator(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function errorMessage(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    return "Требуется активная авторизованная сессия.";
  }
  if (code === "TOO_MANY_REQUESTS") {
    return "Источник ограничил частоту запросов. Дождитесь следующего обновления.";
  }
  if (code === "SERVICE_UNAVAILABLE" || code === "BAD_GATEWAY") {
    return "Binance Spot временно не вернул пригодные данные.";
  }
  return "Не удалось получить рыночные данные. Повторите запрос позже.";
}

function StatusLine({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warning" }) {
  return <span className={`live-market-status live-market-status-${tone}`}>{children}</span>;
}

export default function LiveMarketDataPanel() {
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const query = trpc.marketData.analysis.useQuery(REQUEST, {
    enabled: !OFFLINE_MODE && Boolean(auth.data),
    retry: false,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const chart = useMemo(() => {
    const values = query.data?.candles.map((candle) => Number(candle.close)).filter(Number.isFinite) ?? [];
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || Math.max(Math.abs(max) * 0.000001, 1);
    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 92 - ((value - min) / range) * 84;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return {
      path: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point}`).join(" "),
      rising: values[values.length - 1] >= values[0],
    };
  }, [query.data]);

  if (OFFLINE_MODE) {
    return (
      <section className="panel live-market-panel" aria-labelledby="live-market-title">
        <div className="live-market-heading">
          <div>
            <div className="eyebrow">MARKET DATA INTELLIGENCE</div>
            <h2 id="live-market-title">Биржевые котировки</h2>
          </div>
          <StatusLine>ОФЛАЙН APK</StatusLine>
        </div>
        <p className="panel-subtitle">Сетевой источник отключён в автономной Android-сборке. Демонстрационные графики продолжают работать отдельно.</p>
      </section>
    );
  }

  if (auth.isLoading) {
    return (
      <section className="panel live-market-panel" aria-labelledby="live-market-title">
        <div className="live-market-heading">
          <div>
            <div className="eyebrow">MARKET DATA INTELLIGENCE</div>
            <h2 id="live-market-title">Биржевые котировки</h2>
          </div>
          <StatusLine>ПРОВЕРКА СЕССИИ</StatusLine>
        </div>
        <p className="panel-subtitle">Проверяется авторизованная сессия для защищённого read-only запроса.</p>
      </section>
    );
  }

  if (auth.isError) {
    return (
      <section className="panel live-market-panel" aria-labelledby="live-market-title">
        <div className="live-market-heading">
          <div>
            <div className="eyebrow">MARKET DATA INTELLIGENCE</div>
            <h2 id="live-market-title">Биржевые котировки</h2>
          </div>
          <StatusLine tone="warning"><AlertTriangle size={13} /> СЕССИЯ НЕДОСТУПНА</StatusLine>
        </div>
        <p className="panel-subtitle">Не удалось проверить авторизацию. Запросы к Binance не отправлялись.</p>
      </section>
    );
  }

  if (!auth.data) {
    return (
      <section className="panel live-market-panel" aria-labelledby="live-market-title">
        <div className="live-market-heading">
          <div>
            <div className="eyebrow">MARKET DATA INTELLIGENCE</div>
            <h2 id="live-market-title">Биржевые котировки</h2>
          </div>
          <StatusLine tone="warning"><ShieldCheck size={13} /> ЗАЩИЩЁННЫЙ ДОСТУП</StatusLine>
        </div>
        <p className="panel-subtitle">Для чтения публичных котировок через сервер требуется авторизованная сессия Skill Trader.</p>
      </section>
    );
  }

  const data = query.data;
  const latest = data?.candles[data.candles.length - 1];
  const latestIndicator = data?.indicators[data.indicators.length - 1];
  const latestCandleClosed = latest ? latest.closeTime < Date.now() : false;
  const qualityLabel = data?.quality.status === "ready"
    ? "КАЧЕСТВО: ГОТОВО"
    : data?.quality.status === "degraded"
      ? "КАЧЕСТВО: ЕСТЬ ПРОПУСКИ"
      : data
        ? "НЕДОСТАТОЧНО ИСТОРИИ"
        : "";
  const updatedAt = data
    ? new Date(data.fetchedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const statusText = query.error
    ? "ОШИБКА ОБНОВЛЕНИЯ"
    : data?.freshness === "cached"
      ? "СЕРВЕРНЫЙ КЭШ"
      : data
        ? "ПОЛУЧЕНО С БИРЖИ"
        : query.isFetching
          ? "ЗАПРОС К BINANCE"
          : "ОЖИДАНИЕ ДАННЫХ";

  return (
    <section className="panel live-market-panel" aria-labelledby="live-market-title">
      <div className="live-market-heading">
        <div>
          <div className="eyebrow">MARKET DATA INTELLIGENCE</div>
          <h2 id="live-market-title">BTC / USDT · Binance Spot</h2>
          <p className="panel-subtitle">Отдельный публичный поток. Не связан с демо-инструментом, уровнями риска или симуляцией.</p>
        </div>
        <div className="live-market-actions">
          <StatusLine tone={query.error ? "warning" : data ? "good" : "muted"}>
            {query.error ? <AlertTriangle size={13} /> : data ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
            {statusText}
          </StatusLine>
          <button
            className="live-market-refresh"
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Обновить котировки BTC/USDT"
          >
            <RefreshCw size={14} className={query.isFetching ? "is-spinning" : ""} />
            Обновить
          </button>
        </div>
      </div>

      {query.error && (
        <div className="live-market-error" role="status">
          {errorMessage(query.error)}
          {data && updatedAt ? ` Последний успешный ответ: ${updatedAt}.` : ""}
        </div>
      )}

      {!data && query.isLoading && (
        <div className="live-market-empty" role="status">Загрузка публичных свечей BTC/USDT…</div>
      )}

      {!data && query.error && (
        <div className="live-market-empty" role="status">Котировки пока не получены. Демо-график выше не зависит от этого источника.</div>
      )}

      {data && latest && (
        <>
          <div className="live-market-content">
            <div className="live-market-primary">
              <span className="live-market-label">Последняя цена закрытия / последняя цена свечи</span>
              <strong>{formatDecimal(latest.close)} <small>USDT</small></strong>
              <span className="live-market-timestamp">Ответ сервера: {updatedAt} · интервал 15 минут</span>
            </div>
            {chart && (
              <div className={`live-market-sparkline ${chart.rising ? "is-rising" : "is-falling"}`} aria-label="Линия цен закрытия последних 96 свечей">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
                  <path d={chart.path} className="live-market-sparkline-line" />
                </svg>
                <div className="live-market-sparkline-caption">
                  <span>{formatDecimal(data.candles[0].close)}</span>
                  <span>{formatDecimal(latest.close)}</span>
                </div>
              </div>
            )}
          </div>
          <div className="live-market-metrics">
            <div><span>ОТКРЫТИЕ</span><strong>{formatDecimal(latest.open)}</strong></div>
            <div><span>МАКСИМУМ</span><strong>{formatDecimal(latest.high)}</strong></div>
            <div><span>МИНИМУМ</span><strong>{formatDecimal(latest.low)}</strong></div>
            <div><span>ОБЪЁМ BTC</span><strong>{formatDecimal(latest.volume)}</strong></div>
          </div>
          <div className="live-market-indicator-heading">
            <strong>Технические индикаторы</strong>
            <span>{qualityLabel}</span>
          </div>
          <div className="live-market-indicators">
            <div><span>EMA 20</span><strong>{formatIndicator(latestIndicator?.ema20, 4)}</strong></div>
            <div><span>EMA 50</span><strong>{formatIndicator(latestIndicator?.ema50, 4)}</strong></div>
            <div><span>RSI 14</span><strong>{formatIndicator(latestIndicator?.rsi14, 2)}</strong></div>
            <div><span>MACD HIST</span><strong>{formatIndicator(latestIndicator?.macdHistogram, 5)}</strong></div>
            <div><span>ATR 14</span><strong>{formatIndicator(latestIndicator?.atr14, 4)}</strong></div>
            <div><span>VWAP WINDOW</span><strong>{formatIndicator(latestIndicator?.vwap, 4)}</strong></div>
          </div>
          {data.quality.warnings.length > 0 && (
            <ul className="live-market-quality-warnings">
              {data.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          <div className="live-market-footer">
            <span>{data.quality.closedCandleCount} закрытых свечей · {data.quality.gapCount} пропусков · {data.quality.continuousSegments} сегм.</span>
            <span>{latestCandleClosed ? "Последняя свеча закрыта" : "Последняя свеча ещё формируется"}</span>
            <span>REST read-only · обновление каждые 30 секунд</span>
          </div>
        </>
      )}
    </section>
  );
}
