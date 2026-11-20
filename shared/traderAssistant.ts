import { z } from "zod";

export const TRADER_ASSISTANT_MODEL = "gpt-6-luna" as const;
export const TRADER_ASSISTANT_MAX_PROMPT_CHARACTERS = 1_200;
export const TRADER_ASSISTANT_MAX_HISTORY_MESSAGES = 8;
export const TRADER_ASSISTANT_MAX_HISTORY_CHARACTERS = 8_000;
export const TRADER_ASSISTANT_MAX_RESPONSE_CHARACTERS = 5_000;
export const TRADER_ASSISTANT_PIPELINE_STAGES = [
  { id: "analysis", label: "Разбор вопроса" },
  { id: "risk_check", label: "Проверка чисел риска" },
  { id: "explanation", label: "Учебное объяснение" },
] as const;
export const TRADER_ASSISTANT_PIPELINE_CALLS = TRADER_ASSISTANT_PIPELINE_STAGES.length;
export type TraderAssistantPipelineStageId = typeof TRADER_ASSISTANT_PIPELINE_STAGES[number]["id"];

export const traderAssistantHistoryMessageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    content: z.string().trim().min(1).max(TRADER_ASSISTANT_MAX_PROMPT_CHARACTERS),
  }).strict(),
  z.object({
    role: z.literal("assistant"),
    content: z.string().trim().min(1).max(TRADER_ASSISTANT_MAX_RESPONSE_CHARACTERS),
  }).strict(),
]);

export const traderAssistantScenarioSchema = z.object({
  symbol: z.enum(["XAUUSD", "EURUSD", "BTCUSD"]),
  timeframe: z.enum(["15м", "1ч", "4ч"]),
  side: z.enum(["long", "short"]),
  unit: z.enum(["oz", "EUR", "BTC"]),
  currentPrice: z.number().finite().positive().max(1_000_000_000),
  entry: z.number().finite().positive().max(1_000_000_000),
  stop: z.number().finite().positive().max(1_000_000_000),
  target: z.number().finite().positive().max(1_000_000_000),
  size: z.number().finite().positive().max(1_000_000),
  trials: z.literal(10_000),
  outcomes: z.object({
    target: z.number().finite().min(0).max(100),
    stop: z.number().finite().min(0).max(100),
    other: z.number().finite().min(0).max(100),
  }).strict(),
}).strict().superRefine((scenario, context) => {
  const expectedUnit = scenario.symbol === "XAUUSD"
    ? "oz"
    : scenario.symbol === "EURUSD"
      ? "EUR"
      : "BTC";

  if (scenario.unit !== expectedUnit) {
    context.addIssue({ code: "custom", path: ["unit"], message: "Unit does not match demo instrument" });
  }

  const levelsAreValid = scenario.side === "long"
    ? scenario.stop < scenario.entry && scenario.target > scenario.entry
    : scenario.stop > scenario.entry && scenario.target < scenario.entry;
  if (!levelsAreValid) {
    context.addIssue({ code: "custom", path: ["stop"], message: "Levels do not match scenario direction" });
  }

  const outcomeTotal = scenario.outcomes.target + scenario.outcomes.stop + scenario.outcomes.other;
  if (Math.abs(outcomeTotal - 100) > 0.6) {
    context.addIssue({ code: "custom", path: ["outcomes"], message: "Scenario outcome percentages must total 100" });
  }
});

export function getTraderAssistantScenarioKey(scenario: z.infer<typeof traderAssistantScenarioSchema>): string {
  return JSON.stringify([
    scenario.symbol,
    scenario.timeframe,
    scenario.side,
    scenario.unit,
    scenario.currentPrice,
    scenario.entry,
    scenario.stop,
    scenario.target,
    scenario.size,
    scenario.trials,
    scenario.outcomes.target,
    scenario.outcomes.stop,
    scenario.outcomes.other,
  ]);
}

export const traderAssistantInputSchema = z.object({
  prompt: z.string().trim().min(1).max(TRADER_ASSISTANT_MAX_PROMPT_CHARACTERS),
  history: z.array(traderAssistantHistoryMessageSchema).max(TRADER_ASSISTANT_MAX_HISTORY_MESSAGES),
  scenario: traderAssistantScenarioSchema,
}).strict().superRefine((input, context) => {
  const historyCharacters = input.history.reduce((total, message) => total + message.content.length, 0);
  if (historyCharacters > TRADER_ASSISTANT_MAX_HISTORY_CHARACTERS) {
    context.addIssue({
      code: "custom",
      path: ["history"],
      message: `History exceeds ${TRADER_ASSISTANT_MAX_HISTORY_CHARACTERS} characters in total`,
    });
  }
});

export type TraderAssistantHistoryMessage = z.infer<typeof traderAssistantHistoryMessageSchema>;
export type TraderAssistantScenario = z.infer<typeof traderAssistantScenarioSchema>;
export type TraderAssistantInput = z.infer<typeof traderAssistantInputSchema>;

/** Keep the newest contiguous history suffix that satisfies both server-side budgets. */
export function limitTraderAssistantHistory(
  history: TraderAssistantHistoryMessage[],
): TraderAssistantHistoryMessage[] {
  const newestFirst: TraderAssistantHistoryMessage[] = [];
  let characterCount = 0;

  for (const message of history.slice(-TRADER_ASSISTANT_MAX_HISTORY_MESSAGES).reverse()) {
    if (characterCount + message.content.length > TRADER_ASSISTANT_MAX_HISTORY_CHARACTERS) break;
    newestFirst.push(message);
    characterCount += message.content.length;
  }

  return newestFirst.reverse();
}
