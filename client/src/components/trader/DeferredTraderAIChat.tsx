import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import type { TraderAssistantScenario } from "@shared/traderAssistant";

const TraderAIChat = lazy(() => import("@/components/trader/TraderAIChat"));

type Props = {
  scenario: TraderAssistantScenario;
  simulationReady: boolean;
};

function TraderAIChatPlaceholder({ loading }: { loading: boolean }) {
  return (
    <section
      className="panel trader-ai-panel"
      id="skill-trader-ai"
      aria-labelledby="trader-ai-heading"
      aria-busy={loading}
      style={{ minHeight: 840 }}
    >
      <div className="trader-ai-header">
        <div className="trader-ai-title-wrap">
          <div className="trader-ai-icon">
            <Bot size={17} />
          </div>
          <div>
            <div className="eyebrow">
              УЧЕБНЫЙ ПОМОЩНИК · ТОЛЬКО СИНТЕТИЧЕСКИЙ КОНТЕКСТ
            </div>
            <h2 id="trader-ai-heading">Skill Trader AI</h2>
            <p>
              {loading
                ? "Подготавливаем учебного помощника…"
                : "Чат загрузится автоматически, когда вы приблизитесь к этому разделу."}
            </p>
          </div>
        </div>
      </div>
      {loading && (
        <div className="trader-ai-pending" role="status">
          <Loader2 className="size-3 animate-spin" />
          Загружаем интерфейс чата. Модель не вызывается.
        </div>
      )}
    </section>
  );
}

export default function DeferredTraderAIChat(props: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(section);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sectionRef}>
      {shouldLoad ? (
        <Suspense fallback={<TraderAIChatPlaceholder loading />}>
          <TraderAIChat {...props} />
        </Suspense>
      ) : (
        <TraderAIChatPlaceholder loading={false} />
      )}
    </div>
  );
}
