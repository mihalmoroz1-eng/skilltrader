import React from "react";
import { BotOff } from "lucide-react";
import type { TraderAssistantScenario } from "@shared/traderAssistant";

type Props = {
  scenario: TraderAssistantScenario;
  simulationReady: boolean;
};

export default function OfflineAIUnavailable({ scenario, simulationReady }: Props) {
  return (
    <section
      className="panel trader-ai-panel"
      id="skill-trader-ai"
      aria-labelledby="trader-ai-heading"
      data-offline-demo="true"
    >
      <div className="trader-ai-header">
        <div className="trader-ai-title-wrap">
          <div className="trader-ai-icon" aria-hidden="true">
            <BotOff size={17} />
          </div>
          <div>
            <div className="eyebrow">ОФЛАЙН-ДЕМО · ТОЛЬКО СИНТЕТИЧЕСКИЙ КОНТЕКСТ</div>
            <h2 id="trader-ai-heading">Skill Trader AI</h2>
            <p>Учебный сценарий {scenario.symbol} рассчитывается локально.</p>
          </div>
        </div>
      </div>
      <div className="trader-ai-pending" role="note" aria-live="polite">
        <BotOff size={14} aria-hidden="true" />
        <span>
          {simulationReady
            ? "AI-пояснения отключены в этой офлайн-демо APK. Запросы к серверу не отправляются."
            : "Локальная симуляция выполняется. AI-пояснения отключены, запросы к серверу не отправляются."}
          {" "}Здесь используются только синтетические данные; реальных котировок и торговых операций нет.
        </span>
      </div>
    </section>
  );
}
