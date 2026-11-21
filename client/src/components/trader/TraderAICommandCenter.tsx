import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Command,
  Layers3,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  TRADER_ASSISTANT_PIPELINE_STAGES,
  type TraderAssistantPipelineStageId,
} from "@shared/traderAssistant";

type Prompt = { label: string; prompt: string };
type TabId = "team" | "skills" | "commands";

type Props = {
  completedStages: TraderAssistantPipelineStageId[] | null;
  isBusy: boolean;
  hasError: boolean;
  disabled: boolean;
  prompts: Prompt[];
  onRunCommand: (prompt: string) => void;
};

const TABS: { id: TabId; label: string; count: string; icon: typeof Users }[] = [
  { id: "team", label: "Команда", count: "03", icon: Users },
  { id: "skills", label: "Навыки", count: "06", icon: Layers3 },
  { id: "commands", label: "Команды", count: "03", icon: Command },
];

const ROLES = [
  {
    id: "analysis" as const,
    title: "Разбор вопроса",
    role: "АНАЛИТИК ЗАПРОСА",
    description: "Определяет, относится ли вопрос к учебному сценарию, и выбирает разрешённые факты.",
    icon: Sparkles,
  },
  {
    id: "risk_check" as const,
    title: "Проверка чисел риска",
    role: "СВЕРКА СЦЕНАРИЯ",
    description: "Сопоставляет синтетические входные данные с серверными вычислениями и проверяет согласованность.",
    icon: ShieldCheck,
  },
  {
    id: "explanation" as const,
    title: "Учебное объяснение",
    role: "ВЫБОР ТЕМ",
    description: "Выбирает разрешённые темы; русский ответ затем собирает сервер по фиксированным шаблонам.",
    icon: BookOpen,
  },
];

const SKILLS = [
  { code: "risk_distance", title: "Условный риск", description: "Расстояние от входа до стопа и связанная арифметика." },
  { code: "reward_distance", title: "Потенциальный результат", description: "Расстояние от входа до цели в учебном сценарии." },
  { code: "risk_reward_ratio", title: "Отношение цель / риск", description: "Сопоставление двух синтетических расстояний." },
  { code: "simulation_outcomes", title: "Исходы симуляции", description: "Доли цели, стопа и прочих исходов в модели." },
  { code: "scenario_levels", title: "Уровни сценария", description: "Введённые направление, вход, стоп и цель." },
  { code: "assumptions", title: "Допущения", description: "Синтетические данные, ограничения и неучтённые факторы." },
];

function stageStatus(
  id: TraderAssistantPipelineStageId,
  completedStages: TraderAssistantPipelineStageId[] | null,
  isBusy: boolean,
  hasError: boolean,
) {
  if (isBusy) return { text: "Статус скрыт до итога", kind: "pending" };
  if (hasError) return { text: "Неизвестно после ошибки", kind: "unknown" };
  if (!completedStages) return { text: "Ожидает запроса", kind: "idle" };
  if (completedStages.includes(id)) return { text: "Завершён по квитанции", kind: "complete" };
  return { text: "Не запускался: цепочка остановилась раньше", kind: "stopped" };
}

export default function TraderAICommandCenter({
  completedStages,
  isBusy,
  hasError,
  disabled,
  prompts,
  onRunCommand,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("team");

  return (
    <section className="trader-ai-command-center" aria-label="Командный центр Skill Trader AI">
      <header className="trader-ai-command-header">
        <div>
          <span className="trader-ai-command-kicker">РАБОЧАЯ СРЕДА · УЧЕБНЫЙ РЕЖИМ</span>
          <h3><Workflow size={16} /> Командный центр</h3>
        </div>
        <span className="trader-ai-architecture-badge"><span /> ОДНА МОДЕЛЬ · 3 ЭТАПА</span>
      </header>

      <nav className="trader-ai-command-tabs" aria-label="Разделы командного центра">
        {TABS.map(({ id, label, count, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`trader-ai-command-tab ${activeTab === id ? "is-active" : ""}`}
            aria-pressed={activeTab === id}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={14} /><span>{label}</span><small>{count}</small>
          </button>
        ))}
      </nav>

      {activeTab === "team" && (
        <div className="trader-ai-team-content">
          <div className={`trader-ai-team-notice ${isBusy ? "is-busy" : hasError ? "is-error" : ""}`} role="status">
            {isBusy ? <CircleHelp size={14} /> : hasError ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
            <span>
              {isBusy
                ? "Запрос обрабатывается. Текущий этап не угадывается; статусы будут показаны только из итоговой квитанции."
                : hasError
                  ? "После ошибки фактические этапы неизвестны; скрытый прогресс не восстанавливается."
                  : completedStages
                    ? `Последняя квитанция: ${completedStages.length} из ${TRADER_ASSISTANT_PIPELINE_STAGES.length} этапов завершены.`
                    : "Ожидает вопроса. Полный учебный ответ использует этапы по порядку; безопасный отказ может остановиться раньше."}
            </span>
          </div>
          <div className="trader-ai-role-grid">
            {ROLES.map(({ id, title, role, description, icon: Icon }, index) => {
              const status = stageStatus(id, completedStages, isBusy, hasError);
              return (
                <article className={`trader-ai-role-card status-${status.kind}`} key={id}>
                  <div className="trader-ai-role-top"><span className="trader-ai-role-number">0{index + 1}</span><Icon size={16} /></div>
                  <span className="trader-ai-role-name">{role}</span>
                  <h4>{title}</h4>
                  <p>{description}</p>
                  <span className={`trader-ai-role-status status-${status.kind}`}>{status.text}</span>
                </article>
              );
            })}
          </div>
          <p className="trader-ai-one-model-note">Это три последовательные стадии одного вызванного пользователем конвейера, а не три независимых агента. Внутренние JSON и рассуждения не показываются.</p>
        </div>
      )}

      {activeTab === "skills" && (
        <div className="trader-ai-skills-content">
          <div className="trader-ai-tab-intro"><span>РАЗРЕШЁННЫЕ ТЕМЫ</span><p>Сервер принимает только эти учебные коды; новые источники данных и торговые действия не подключены.</p></div>
          <div className="trader-ai-skill-grid">
            {SKILLS.map(({ code, title, description }, index) => (
              <article className="trader-ai-skill-card" key={code}>
                <span className="trader-ai-skill-index">0{index + 1}</span>
                <div><h4>{title}</h4><p>{description}</p><code>{code}</code></div>
                <CheckCircle2 size={14} aria-label="Разрешённая тема" />
              </article>
            ))}
          </div>
        </div>
      )}

      {activeTab === "commands" && (
        <div className="trader-ai-commands-content">
          <div className="trader-ai-tab-intro"><span>БЫСТРЫЕ КОМАНДЫ</span><p>Нажатие сразу отправляет обычный вопрос Skill Trader AI для текущего синтетического сценария.</p></div>
          <div className="trader-ai-command-list">
            {prompts.map(({ label, prompt }, index) => (
              <button
                className="trader-ai-command-row"
                key={prompt}
                type="button"
                disabled={disabled || isBusy}
                onClick={() => onRunCommand(prompt)}
              >
                <span className="trader-ai-command-index">0{index + 1}</span>
                <span className="trader-ai-command-copy"><strong>{label}</strong><small>{prompt}</small></span>
                <span className="trader-ai-command-action">ОТПРАВИТЬ <Command size={12} /></span>
              </button>
            ))}
          </div>
          <div className="trader-ai-command-cost"><ShieldCheck size={14} /><span>Каждый запуск может занять до 90 секунд и вызвать до трёх последовательных обращений к модели, расходуя project credits. Нажатие — ваше явное согласие отправить вопрос.</span></div>
        </div>
      )}
    </section>
  );
}
