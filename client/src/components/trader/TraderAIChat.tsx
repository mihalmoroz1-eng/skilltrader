import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Clock3, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import {
  TRADER_ASSISTANT_MODEL,
  limitTraderAssistantHistory,
  getTraderAssistantScenarioKey,
  traderAssistantScenarioSchema,
  type TraderAssistantInput,
  type TraderAssistantPipelineStageId,
  type TraderAssistantScenario,
} from "@shared/traderAssistant";
import { trpc } from "@/lib/trpc";
import TraderAICommandCenter from "@/components/trader/TraderAICommandCenter";

type ConversationMessage = { role: "user" | "assistant"; content: string };
type PipelineReceipt = { modelCalls: number; completedStages: TraderAssistantPipelineStageId[] };

const SUGGESTED_PROMPTS = [
  "Объясни разницу между условным риском и потенциальным результатом.",
  "Что означают доли исходов в этой симуляции?",
  "Как рассчитывается отношение потенциального расстояния к риску?",
];

export default function TraderAIChat({ scenario, simulationReady }: { scenario: TraderAssistantScenario; simulationReady: boolean }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const [requestError, setRequestError] = useState("");
  const [failedRequest, setFailedRequest] = useState<TraderAssistantInput | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [callCountMayBeUnknown, setCallCountMayBeUnknown] = useState(false);
  const [scenarioResetNotice, setScenarioResetNotice] = useState(false);
  const [pipelineReceipt, setPipelineReceipt] = useState<PipelineReceipt | null>(null);
  const scenarioResult = traderAssistantScenarioSchema.safeParse(scenario);
  const scenarioIsValid = scenarioResult.success;
  const scenarioKey = scenarioIsValid ? getTraderAssistantScenarioKey(scenarioResult.data) : "invalid";
  const latestScenarioKeyRef = useRef(scenarioKey);
  const conversationScenarioKeyRef = useRef(scenarioKey);

  useLayoutEffect(() => {
    latestScenarioKeyRef.current = scenarioKey;
  }, [scenarioKey]);

  useEffect(() => {
    if (conversationScenarioKeyRef.current === scenarioKey) return;
    conversationScenarioKeyRef.current = scenarioKey;
    messagesRef.current = [];
    setMessages([]);
    setRequestError("");
    setFailedRequest(null);
    setCanRetry(false);
    setPipelineReceipt(null);
    setScenarioResetNotice(true);
  }, [scenarioKey]);

  const appendMessage = (message: ConversationMessage) => {
    const next = [...messagesRef.current, message].slice(-40);
    messagesRef.current = next;
    setMessages(next);
  };

  const chatMutation = trpc.traderAssistant.chat.useMutation({
    onSuccess: (response, variables) => {
      if (getTraderAssistantScenarioKey(variables.scenario) !== latestScenarioKeyRef.current) return;
      setRequestError("");
      setFailedRequest(null);
      setCanRetry(false);
      setPipelineReceipt({ modelCalls: response.modelCalls, completedStages: response.completedStages });
      appendMessage({ role: "assistant", content: response.text });
    },
    onError: (error, variables) => {
      if (getTraderAssistantScenarioKey(variables.scenario) !== latestScenarioKeyRef.current) return;
      setRequestError(error.message);
      setFailedRequest(variables);
      setPipelineReceipt(null);
      const errorCode = error.data?.code;
      setCanRetry(errorCode === "SERVICE_UNAVAILABLE");
      setCallCountMayBeUnknown(
        errorCode === "INTERNAL_SERVER_ERROR"
        || errorCode === "SERVICE_UNAVAILABLE"
        || (errorCode === "TOO_MANY_REQUESTS" && error.message.startsWith("Сервис AI ограничил"))
        || (errorCode === "PRECONDITION_FAILED" && (error.message.includes("Недостаточно project credits") || error.message.includes("Модель отклонила запрос"))),
      );
    },
  });

  const sendMessage = (content: string) => {
    if (!scenarioResult.success || !simulationReady || chatMutation.isPending) return;
    const prompt = content.trim();
    if (!prompt) return;

    const conversationMatchesScenario = conversationScenarioKeyRef.current === scenarioKey;
    if (!conversationMatchesScenario) {
      conversationScenarioKeyRef.current = scenarioKey;
      messagesRef.current = [];
      setMessages([]);
      setRequestError("");
      setFailedRequest(null);
      setCanRetry(false);
      setPipelineReceipt(null);
      setScenarioResetNotice(true);
    }

    const request: TraderAssistantInput = {
      prompt,
      scenario: scenarioResult.data,
      history: conversationMatchesScenario
        ? limitTraderAssistantHistory(messagesRef.current.map(({ role, content: messageContent }) => ({ role, content: messageContent })))
        : [],
    };
    appendMessage({ role: "user", content: prompt });
    setRequestError("");
    setFailedRequest(null);
    setCanRetry(false);
    setPipelineReceipt(null);
    setScenarioResetNotice(false);
    chatMutation.mutate(request);
  };

  const clearConversation = () => {
    conversationScenarioKeyRef.current = scenarioKey;
    messagesRef.current = [];
    setMessages([]);
    setRequestError("");
    setFailedRequest(null);
    setCanRetry(false);
    setPipelineReceipt(null);
    setScenarioResetNotice(false);
  };

  const retry = () => {
    if (!failedRequest || !canRetry || chatMutation.isPending) return;
    if (!scenarioResult.success || getTraderAssistantScenarioKey(failedRequest.scenario) !== scenarioKey) {
      clearConversation();
      return;
    }
    setRequestError("");
    setCanRetry(false);
    setPipelineReceipt(null);
    chatMutation.mutate(failedRequest);
  };

  return (
    <section className="panel trader-ai-panel" id="skill-trader-ai" aria-labelledby="trader-ai-heading">
      <div className="trader-ai-header">
        <div className="trader-ai-title-wrap">
          <div className="trader-ai-icon"><Bot size={17} /></div>
          <div>
            <div className="eyebrow">УЧЕБНЫЙ ПОМОЩНИК · ТОЛЬКО СИНТЕТИЧЕСКИЙ КОНТЕКСТ</div>
            <h2 id="trader-ai-heading">Skill Trader AI</h2>
            <p>Объясняет расчёты текущего сценария, не выдаёт торговых сигналов.</p>
          </div>
        </div>
        <div className="trader-ai-actions">
          <span className="trader-ai-model">{TRADER_ASSISTANT_MODEL}</span>
          <button className="trader-ai-clear" type="button" onClick={clearConversation} disabled={chatMutation.isPending || messages.length === 0} aria-label="Очистить диалог" title="Очистить диалог">
            <Trash2 size={14} /><span>Очистить</span>
          </button>
        </div>
      </div>

      <TraderAICommandCenter
        completedStages={pipelineReceipt?.completedStages ?? null}
        isBusy={chatMutation.isPending}
        hasError={Boolean(requestError)}
        disabled={!scenarioIsValid || !simulationReady}
        prompts={[
          { label: "Разобрать риск и результат", prompt: SUGGESTED_PROMPTS[0] },
          { label: "Понять исходы симуляции", prompt: SUGGESTED_PROMPTS[1] },
          { label: "Проверить отношение цель / риск", prompt: SUGGESTED_PROMPTS[2] },
        ]}
        onRunCommand={sendMessage}
      />

      {chatMutation.isPending && (
        <div className="trader-ai-pipeline-status" role="status">
          Запрос обрабатывается последовательно; при неразрешённом намерении или несогласованной сверке цепочка остановится раньше. Полное учебное объяснение требует три вызова. Внутренние результаты не показываются; каждый этап ограничен 30 секундами.
        </div>
      )}
      {pipelineReceipt && !chatMutation.isPending && (
        <div className="trader-ai-pipeline-status is-complete" role="status">
          Последний ответ: {pipelineReceipt.completedStages.length}/3 этапа завершены · {pipelineReceipt.modelCalls} обращения к модели.
        </div>
      )}

      <div className="trader-ai-disclosure" role="note">
        <ShieldCheck size={15} />
        <p><strong>Перед отправкой:</strong> вопрос и до 8 предыдущих сообщений (не более 8 000 символов суммарно) обрабатываются последовательными этапами `gpt-6-luna`. История передаётся как недоверенный цитируемый контекст, не как роли/инструкции модели; часть старых сообщений может не войти в лимит. Второй этап получает синтетические параметры, вычисления сервера и ограниченные fact-ID. Каждый этап ограничен 30 секундами, полный ответ может занять до 90 секунд. Успешное учебное объяснение требует 3 вызова; при запрещённом намерении или несогласованной сверке сервер остановит цепочку раньше и вернёт безопасный шаблон. Поэтому выше задержка и расход project credits. При сбое уже отправленные вызовы тоже могут расходовать credits; ручной повтор запускает цепочку заново и может выполнить ещё до 3 вызовов. Кнопка полного повтора доступна только при временной ошибке сервиса; лимит частоты, дневной лимит и нехватка project credits требуют подождать/пополнить лимит и отправить вопрос вручную. Промежуточные JSON не показываются и не сохраняются. Журнал, настройки счёта и localStorage не передаются. Не вводите личные данные, пароли или ключи. Сверка чисел не является финансовой рекомендацией или гарантией точности.</p>
      </div>

      {!scenarioIsValid && (
        <div className="trader-ai-invalid" role="status"><AlertTriangle size={14} /> Проверьте направление, вход, стоп и цель: пока уровни некорректны, отправка отключена.</div>
      )}
      {scenarioIsValid && !simulationReady && (
        <div className="trader-ai-pending" role="status"><Clock3 size={14} /> Пересчитываем синтетические результаты. Отправка возобновится, когда сценарий и доли исходов будут согласованы.</div>
      )}
      {scenarioResetNotice && (
        <div className="trader-ai-context-reset" role="status">Параметры сценария изменились — история очищена, чтобы не смешивать разные расчёты.</div>
      )}
      {requestError && (
        <div className="trader-ai-error" role="alert">
          <span><AlertTriangle size={14} />{requestError}</span>
          {callCountMayBeUnknown && <p className="trader-ai-error-note">После сбоя точное число завершившихся/оплаченных вызовов не отображается; уже отправленные этапы могли списать project credits.</p>}
          {failedRequest && canRetry && <button type="button" onClick={retry} disabled={chatMutation.isPending}><RotateCcw size={13} />Перезапустить всю цепочку</button>}
        </div>
      )}

      <AIChatBox
        messages={messages}
        onSendMessage={sendMessage}
        isLoading={chatMutation.isPending}
        disabled={!scenarioIsValid || !simulationReady}
        maxLength={1_200}
        height={420}
        className="trader-ai-box"
        placeholder="Спросите об учебных расчётах сценария…"
        emptyStateMessage="Задайте вопрос о текущих синтетических параметрах"
        suggestedPrompts={SUGGESTED_PROMPTS}
      />
      <div className="trader-ai-footnote">Полное учебное объяснение требует трёх последовательных модельных вызовов; безопасный отказ может завершиться после первого или второго этапа. Диалог хранится только в памяти этой вкладки; при изменении сценария история очищается. Live-котировки не используются.</div>
    </section>
  );
}
