import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Clock3, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import {
  TRADER_ASSISTANT_MODEL,
  getTraderAssistantScenarioKey,
  traderAssistantScenarioSchema,
  type TraderAssistantInput,
  type TraderAssistantScenario,
} from "@shared/traderAssistant";
import { trpc } from "@/lib/trpc";

type ConversationMessage = { role: "user" | "assistant"; content: string };

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
  const [scenarioResetNotice, setScenarioResetNotice] = useState(false);
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
      appendMessage({ role: "assistant", content: response.text });
    },
    onError: (error, variables) => {
      if (getTraderAssistantScenarioKey(variables.scenario) !== latestScenarioKeyRef.current) return;
      setRequestError(error.message);
      setFailedRequest(variables);
      const errorCode = error.data?.code;
      setCanRetry(errorCode === "SERVICE_UNAVAILABLE" || errorCode === "TOO_MANY_REQUESTS");
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
      setScenarioResetNotice(true);
    }

    const request: TraderAssistantInput = {
      prompt,
      scenario: scenarioResult.data,
      history: conversationMatchesScenario
        ? messagesRef.current.slice(-8).map(({ role, content: messageContent }) => ({ role, content: messageContent }))
        : [],
    };
    appendMessage({ role: "user", content: prompt });
    setRequestError("");
    setFailedRequest(null);
    setCanRetry(false);
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

      <div className="trader-ai-disclosure" role="note">
        <ShieldCheck size={15} />
        <p><strong>Перед отправкой:</strong> на серверную модель проекта уйдут ваш вопрос, до 8 предыдущих реплик и параметры этого синтетического сценария (инструмент, период, условная цена, направление, уровни, размер и доли симуляции). Журнал, настройки счёта и localStorage автоматически не передаются. Не вводите личные данные, пароли или ключи. Запрос расходует кредиты проекта; ответы не являются финансовой рекомендацией.</p>
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
          {failedRequest && canRetry && <button type="button" onClick={retry} disabled={chatMutation.isPending}><RotateCcw size={13} />Повторить</button>}
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
      <div className="trader-ai-footnote">Диалог хранится только в памяти этой вкладки. При изменении сценария история очищается. Live-котировки не используются.</div>
    </section>
  );
}
