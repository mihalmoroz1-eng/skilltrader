import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, CircleAlert, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { appendSignalAuditEvent, readSignalAuditJournal } from "@/lib/signalAuditJournal";
import type { SignalAuditEvent } from "@shared/signalValidation";
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
const SIGNAL_STATUS_LABELS: Record<string, string> = {
  reviewable: "Готов к аналитическому просмотру",
  rejected: "Отклонён проверками",
  inconclusive: "Недостаточно подтверждений",
  no_candidate: "Кандидат не сформирован",
};
const CHECK_LABELS: Record<string, string> = {
  market_data_integrity: "Качество и свежесть данных",
  agent_consensus: "Согласованность AI-агентов",
  directional_evidence: "Подтверждение направления",
  strategy_alignment: "Соответствие контексту стратегии",
  technical_risk_gate: "Детерминированный технический фильтр риска",
  account_risk_engine: "Серверный расчёт денежного риска и размера позиции",
};
const CHECK_STATE_LABELS: Record<string, string> = {
  passed: "Пройдено",
  failed: "Не пройдено",
  inconclusive: "Не подтверждено",
  not_connected: "Не подключён",
};
const AUDIT_EVENT_LABELS: Record<SignalAuditEvent["eventType"], string> = {
  candidate_recorded: "Кандидат записан",
  accepted_for_further_review: "Принят для дальнейшей проверки",
  dismissed: "Отклонён при ручном просмотре",
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
  const [auditEvents, setAuditEvents] = useState<SignalAuditEvent[]>(() => readSignalAuditJournal());
  const [auditStorageAvailable, setAuditStorageAvailable] = useState<boolean | null>(null);
  const [auditFeedback, setAuditFeedback] = useState("");
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

  const data = query.data;
  const signalValidation = data?.signalValidation;
  const signalCandidate = signalValidation?.candidate;

  useEffect(() => {
    if (!signalCandidate || !signalValidation) return;
    const stored = appendSignalAuditEvent({
      signalId: signalCandidate.signalId,
      marketRunId: signalCandidate.marketRunId,
      validationDigest: signalValidation.provenance.validationDigest,
      eventType: "candidate_recorded",
      noteCode: "automatic_record",
    }, signalCandidate.createdAt);
    setAuditEvents(readSignalAuditJournal());
    setAuditStorageAvailable(stored);
  }, [signalCandidate?.signalId]);

  const recordManualDecision = (accepted: boolean) => {
    if (!signalCandidate || !signalValidation) return;
    const stored = appendSignalAuditEvent({
      signalId: signalCandidate.signalId,
      marketRunId: signalCandidate.marketRunId,
      validationDigest: signalValidation.provenance.validationDigest,
      eventType: accepted ? "accepted_for_further_review" : "dismissed",
      noteCode: accepted ? "manual_review_accepted" : "manual_review_dismissed",
    });
    setAuditEvents(readSignalAuditJournal());
    setAuditStorageAvailable(stored);
    setAuditFeedback(stored
      ? accepted ? "Решение записано в локальный журнал." : "Отклонение записано в локальный журнал."
      : "Не удалось сохранить событие в локальный журнал устройства.");
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

          {data.signalValidation && (
            <section className="market-signal-validation" aria-labelledby="market-signal-title">
              <div className="market-signal-heading">
                <div>
                  <div className="eyebrow">SIGNAL VALIDATION ENGINE</div>
                  <h3 id="market-signal-title">Проверка кандидата сигнала</h3>
                </div>
                <span className={`market-signal-status is-${data.signalValidation.status}`}>
                  {SIGNAL_STATUS_LABELS[data.signalValidation.status] ?? data.signalValidation.status}
                </span>
              </div>

              {data.signalValidation.candidate ? (
                <div className="market-signal-candidate">
                  <div className="market-signal-direction">
                    <span>КАНДИДАТ НАПРАВЛЕНИЯ</span>
                    <strong className={data.signalValidation.candidate.direction === "LONG" ? "is-long" : "is-short"}>
                      {data.signalValidation.candidate.direction}
                    </strong>
                    <small>{data.signalValidation.candidate.symbol} · {data.signalValidation.candidate.interval}</small>
                  </div>
                  <div className="market-signal-thesis">
                    <strong>Подтверждающие свидетельства</strong>
                    <EvidenceList codes={data.signalValidation.candidate.thesisCodes} labels={EVIDENCE_LABELS} />
                  </div>
                </div>
              ) : (
                <p className="market-intelligence-note">По текущим правилам подтверждённый кандидат направления не сформирован.</p>
              )}

              <div className="market-signal-checks">
                {data.signalValidation.checks.map((check) => (
                  <div className="market-signal-check" key={check.key}>
                    <span>{CHECK_LABELS[check.key] ?? check.key}</span>
                    <strong className={`is-${check.state}`}>{CHECK_STATE_LABELS[check.state] ?? check.state}</strong>
                  </div>
                ))}
              </div>

              {data.signalValidation.rejectedReasonCodes.length > 0 && (
                <div className="market-signal-reasons">
                  <strong>Причины и ограничения</strong>
                  <ul>
                    {data.signalValidation.rejectedReasonCodes.map((code, index) => (
                      <li key={`${code}-${index}`}>{code.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.signalValidation.warnings.map((warning) => (
                <p className="market-signal-warning" key={warning}>{warning}</p>
              ))}

              {data.signalValidation.status === "reviewable" && data.signalValidation.candidate && (
                <div className="market-signal-review-actions">
                  <button type="button" onClick={() => recordManualDecision(true)}>
                    Принять для дальнейшей проверки
                  </button>
                  <button type="button" className="is-dismiss" onClick={() => recordManualDecision(false)}>
                    Отклонить кандидат
                  </button>
                </div>
              )}
              {auditFeedback && <p className="market-intelligence-note" role="status">{auditFeedback}</p>}

              <details className="market-signal-audit">
                <summary>Локальный журнал происхождения · {auditEvents.length} событий</summary>
                <p>
                  {auditStorageAvailable === false
                    ? "Хранилище устройства недоступно. События не были сохранены."
                    : "Журнал находится только в хранилище этого браузера и не является защищённым серверным аудитом."}
                </p>
                {auditEvents.length === 0
                  ? <span className="market-intelligence-none">Пока нет записей</span>
                  : (
                    <ul>
                      {auditEvents.slice(-8).reverse().map((event) => (
                        <li key={event.eventId}>
                          <strong>{AUDIT_EVENT_LABELS[event.eventType]}</strong>
                          <span>{new Date(event.occurredAt).toLocaleString("ru-RU")}</span>
                          <code>{event.signalId}</code>
                        </li>
                      ))}
                    </ul>
                  )}
              </details>

              <div className="market-signal-no-execution">
                <ShieldCheck size={15} />
                <span>Только ручной аналитический просмотр. Исполнение заблокировано: серверный Account Risk Engine не подключён. Ордеры не отправляются.</span>
              </div>
            </section>
          )}

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
