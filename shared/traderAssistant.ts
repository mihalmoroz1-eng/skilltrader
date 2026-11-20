import { z } from "zod";

export const TRADER_ASSISTANT_MODEL = "gpt-6-luna" as const;

export const traderAssistantHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(1_600),
}).strict();

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
  prompt: z.string().trim().min(1).max(1_200),
  history: z.array(traderAssistantHistoryMessageSchema).max(8),
  scenario: traderAssistantScenarioSchema,
}).strict();

export type TraderAssistantHistoryMessage = z.infer<typeof traderAssistantHistoryMessageSchema>;
export type TraderAssistantScenario = z.infer<typeof traderAssistantScenarioSchema>;
export type TraderAssistantInput = z.infer<typeof traderAssistantInputSchema>;
