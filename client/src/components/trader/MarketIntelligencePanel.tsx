import { useState, type ReactNode } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, CircleAlert, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./MarketIntelligencePanel.css";

const OFFLINE_MODE = import.meta.env.VITE_APP_MODE === "android-demo";
const REQUEST = { symbol: "BTCUSDT", interval: "15m" as const, limit: 96 };

const MARKET_LABELS: Record<string, string> = {
  uptrend: "Восходящая структура",
  downtrend: "Нисходящая структура",
  range: "Диапазон",
  mixed: "Смешанная структура",
};
const MOMENTUM_LABELS: Record<string, string> = {
  positive: "Положительный",
  negative: "Отрицательный",
  mixed: "Смешанный",
  neutral: "Нейтральный",
};
const STRATEGY_LABELS: Record<string, string> = {
  trend_context: "Трендовый контекст",
  mean_reversion_context: "Контекст возврата к среднему",
  mixed_context: "Смешанный контекст",
  no_clear_context: "Недостаточно ясный контекст",
};
const RISK_LABELS: Record<string, string> = {
  normal: "Обычный технический режим",
  elevated: "Повышенная техническая волатильность",
  uncertain: "Неопределённый режим",
};
const CRITIC_LABELS: Record<string, string> = {
  consistent: "Явных противоречий не выявлено",
  contradictory: "Обнаружены противоречия",
  insufficient_evidence: "Недостаточно доказательств",
};
const EVIDENCE_LABELS: Record<string, string> = {
  close_above_ema20: "Цена выше EMA 20",
  close_below_ema20: "Цена ниже EMA 20",
  ema20_above_ema50: "EMA 20 выше EMA 50",
  ema20_below_ema50: "EMA 20 ниже EMA 50",
  rsi_overbought: "RSI в зоне выше 70",
  rsi_oversold: "RSI в зоне ниже 30",
  rsi_neutral: "RSI вне крайних зон",
  macd_histogram_positive: "Гистограмма MACD положительная",
  macd_histogram_negative: "Гистограмма MACD отрицательная",
  close_above_vwap: "Цена выше VWAP окна",
  close_below_vwap: "Цена ниже VWAP окна",
  trend_structure_up: "Показатели согласуются с восходящей структурой",
  trend_structure_down: "Показатели согласуются с нисходящей структурой",
  trend_structure_mixed: "Трендовые показатели не согласованы",
};
const RISK_EVIDENCE_LABELS: Record<string, string> = {
  atr_ratio_below_0_5_percent: "ATR ниже 0,5% цены",
  atr_ratio_0_5_to_2_percent: "ATR от 0,5% до 2% цены",
  atr_ratio_above_2_percent: "ATR выше 2% цены",
  rsi_extreme: "RSI находится в крайней зоне",
  price_extension_from_ema20: "Отклонение цены от EMA 20 не менее 1,5%",
  indicator_disagreement: "Часть индикаторов расходится",
};
const CONFLICT_LABELS: Record<string, string> = {
  market_strategy_disagreement: "Расхождение Market и Strategy Context",
  market_risk_disagreement: "Расхождение Market и Risk Context",
  unsupported_evidence: "Вывод использует неподтверждённое свидетельство",
  unsupported_certainty: "Степень определённости не подтверждена данными",
  data_quality_disagreement: "Расхождение в оценке качества данных",
};

function safeErrorMessage(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return "Нужна авторизованная сессия Skill Trader.";
  if (code === "TOO_MANY_REQUESTS") return "Лимит запусков достигнут. Дождитесь разрешённого времени следующего запроса.";
  if (code === "PRECONDITION_FAILED") return "Trust Gate не разрешил анализ: проверьте свежесть и качество рыночных данных.";
  if (code === "SERVICE_UNAVAILABLE") return "Один из AI-агентов или источник данных временно недоступен. Частичный результат не показан.";
  if (code === "BAD_GATEWAY") return "AI-агент вернул некорректный формат. Результат отклонён.";
  return "Мультиагентный анализ не завершён.";
}

function EvidenceList({ codes, labels }: { codes: string[]; labels: Record<string, string> }) {
  if (codes.length === 0) return <span className="market-intelligence-none">Нет подтверждённых кодов свидетельств</span>;
  return (
    <ul className="market-intelligence-evidence">
      {codes.map((code) => <li key={code}>{labels[code] ?? "Неизвестный код"}</li>)}
    </ul>
  );
}

function AgentCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="market-intelligence-agent">
      <div className="market-intelligence-agent-title">{icon}<strong>{title}</strong></div>
      {children}
    </article>
  );
}

export default function MarketIntelligencePanel() {
  const [started, setStarted] = useState(false);
  const auth = trpc.auth.me.useQuery(undefined, {
    enabled: !OFFLINE_MODE,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const query = trpc.marketIntelligence.analyze.useQuery(REQUEST, {
    enabled: false,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const runAnalysis = () => {
    setStarted(true);
    void query.refetch();
  };

  if (OFFLINE_MODE) {
    return (
      <section className="panel market-intelligence-panel">
        <div className="market-intelligence-heading">
          <div><div className="eyebrow">AI MARKET INTELLIGENCE</div><h2>Мультиагентный анализ</h2></div>
          <span className="market-intelligence-status">OFFLINE APK</span>
        </div>
        <p className="panel-subtitle">AI-сеть отключена в автономной Android-сборке. Локальные демонстрационные инструменты продолжают работать.</p>
      </section>
    );
  }

  const data = query.data;

  return (
    <section className="panel market-intelligence-panel" aria-labelledby="market-intelligence-title">
      <div className="market-intelligence-heading">
        <div>
          <div className="eyebrow">AI MARKET INTELLIGENCE</div>
          <h2 id="market-intelligence-title">Мультиагентный анализ · BTC / USDT</h2>
          <p className="panel-subtitle">Четыре структурированных AI-этапа. Результат — аналитическая классификация, не торговый сигнал.</p>
        </div>
        <span className="market-intelligence-status"><ShieldCheck size={13} /> TRUST-GATED</span>
      </div>

      {auth.isLoading && <p className="market-intelligence-note">Проверка авторизованной сессии…</p>}
      {auth.isError && <p className="market-intelligence-error">Не удалось проверить сессию. AI-запрос не запускался.</p>}
      {!auth.isLoading && !auth.isError && !auth.data && (
        <p className="market-intelligence-note">Для запуска анализа требуется авторизованная сессия.</p>
      )}

      {auth.data && (
        <div className="market-intelligence-launch">
          <div>
            <strong>Запуск только вручную</strong>
            <span>4 модельных вызова · лимит 2 запуска в минуту и 20 в сутки на пользователя</span>
          </div>
          <button
            type="button"
            className="market-intelligence-run"
            onClick={runAnalysis}
            disabled={query.isFetching || auth.isLoading}
          >
            <Play size={14} />
            {query.isFetching ? "Анализ выполняется…" : "Запустить анализ"}
          </button>
        </div>
      )}

      {query.isFetching && (
        <div className="market-intelligence-progress" role="status">
          <BrainCircuit size={16} />
          Market, Strategy Context и Risk работают параллельно; Critic проверит их результаты. Частичные выводы не публикуются.
        </div>
      )}

      {query.error && (
        <div className="market-intelligence-error" role="alert">
          <AlertTriangle size={15} /> {safeErrorMessage(query.error)}
        </div>
      )}

      {!data && !query.isFetching && !query.error && started && (
        <p className="market-intelligence-note">Запрос завершился без результата.</p>
      )}

      {data && (
        <>
          <div className={`market-intelligence-result-status ${data.status === "reviewable" ? "is-reviewable" : "is-inconclusive"}`}>
            {data.status === "reviewable" ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
            <div>
              <strong>{data.status === "reviewable" ? "Результаты согласованы для просмотра" : "Результат неоднозначен"}</strong>
              <span>{data.status === "reviewable" ? "Это не означает, что классификация прогнозно точна." : "Не использовать как основу для торгового решения."}</span>
            </div>
          </div>

          <div className="market-intelligence-agent-grid">
            <AgentCard title="Market Agent" icon={<BrainCircuit size={15} />}>
              <strong>{MARKET_LABELS[data.market.regime] ?? data.market.regime}</strong>
              <span>Импульс: {MOMENTUM_LABELS[data.market.momentum] ?? data.market.momentum}</span>
              <EvidenceList codes={data.market.evidenceCodes} labels={EVIDENCE_LABELS} />
            </AgentCard>
            <AgentCard title="Strategy Context" icon={<BrainCircuit size={15} />}>
              <strong>{STRATEGY_LABELS[data.strategy.context] ?? data.strategy.context}</strong>
              <EvidenceList codes={data.strategy.evidenceCodes} labels={EVIDENCE_LABELS} />
            </AgentCard>
            <AgentCard title="Risk Context" icon={<ShieldCheck size={15} />}>
              <strong>{RISK_LABELS[data.risk.regime] ?? data.risk.regime}</strong>
              <EvidenceList codes={data.risk.riskEvidenceCodes} labels={RISK_EVIDENCE_LABELS} />
            </AgentCard>
            <AgentCard title="Critic Agent" icon={<CircleAlert size={15} />}>
              <strong>{CRITIC_LABELS[data.critic.verdict] ?? data.critic.verdict}</strong>
              {data.critic.conflictCodes.length > 0
                ? <EvidenceList codes={data.critic.conflictCodes} labels={CONFLICT_LABELS} />
                : <span className="market-intelligence-none">Конфликтные коды не возвращены</span>}
            </AgentCard>
          </div>

          {data.warnings.length > 0 && (
            <ul className="market-intelligence-warnings">
              {data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}

          <details className="market-intelligence-provenance">
            <summary>Происхождение и проверка результата</summary>
            <dl>
              <div><dt>Run ID</dt><dd>{data.runId}</dd></div>
              <div><dt>Источник</dt><dd>{data.provenance.source} · {data.provenance.symbol} · {data.provenance.interval}</dd></div>
              <div><dt>Свечи</dt><dd>{data.provenance.closedCandleCount} закрытых · {data.provenance.gapCount} пропусков</dd></div>
              <div><dt>Свежесть данных</dt><dd>{Math.max(0, data.provenance.dataAgeMs)} мс</dd></div>
              <div><dt>Prompt version</dt><dd>{data.provenance.promptVersion}</dd></div>
              <div><dt>Модели</dt><dd>{Object.entries(data.provenance.modelByAgent).map(([agent, model]) => `${agent}: ${model}`).join(" · ")}</dd></div>
              <div><dt>Evidence SHA-256</dt><dd className="market-intelligence-hash">{data.provenance.evidenceDigest}</dd></div>
            </dl>
          </details>

          <div className="market-intelligence-safety">
            <ShieldCheck size={15} />
            <span>Сигнал LONG/SHORT не создан. Объём позиции не рассчитан. Ордеры не отправлялись.</span>
          </div>
        </>
      )}
    </section>
  );
}
