import { describe, expect, it } from "vitest";
import {
  getTraderAssistantScenarioKey,
  traderAssistantInputSchema,
  type TraderAssistantInput,
} from "../shared/traderAssistant";
import {
  buildTraderAssistantMessages,
  TraderAssistantRateLimiter,
  TRADER_ASSISTANT_SYSTEM_PROMPT,
} from "./traderAssistant";

const validInput: TraderAssistantInput = {
  prompt: "Объясни результат учебной модели.",
  history: [
    { role: "user", content: "Что означает риск?" },
    { role: "assistant", content: "Это условное расстояние до стопа." },
  ],
  scenario: {
    symbol: "XAUUSD",
    timeframe: "1ч",
    side: "long",
    unit: "oz",
    currentPrice: 2_354.2,
    entry: 2_350,
    stop: 2_340,
    target: 2_370,
    size: 1,
    trials: 10_000,
    outcomes: { target: 61.2, stop: 25.4, other: 13.4 },
  },
};

describe("Skill Trader AI input contract", () => {
  it("accepts a bounded synthetic scenario and up to eight dialogue turns", () => {
    expect(traderAssistantInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("changes the chat context key when any scenario-driving value changes", () => {
    const key = getTraderAssistantScenarioKey(validInput.scenario);
    expect(getTraderAssistantScenarioKey({ ...validInput.scenario })).toBe(key);
    expect(getTraderAssistantScenarioKey({ ...validInput.scenario, entry: 2_351 })).not.toBe(key);
    expect(getTraderAssistantScenarioKey({ ...validInput.scenario, outcomes: { target: 60.2, stop: 26.4, other: 13.4 } })).not.toBe(key);
  });

  it("rejects private/browser-only fields and unknown context properties", () => {
    expect(traderAssistantInputSchema.safeParse({
      ...validInput,
      scenario: { ...validInput.scenario, balance: 500, journal: "local" },
    }).success).toBe(false);
    expect(traderAssistantInputSchema.safeParse({
      ...validInput,
      history: Array.from({ length: 9 }, () => ({ role: "user", content: "вопрос" })),
    }).success).toBe(false);
  });

  it("rejects mismatched instrument units, invalid levels, and inconsistent outcomes", () => {
    expect(traderAssistantInputSchema.safeParse({
      ...validInput,
      scenario: { ...validInput.scenario, unit: "BTC" },
    }).success).toBe(false);
    expect(traderAssistantInputSchema.safeParse({
      ...validInput,
      scenario: { ...validInput.scenario, stop: 2_360 },
    }).success).toBe(false);
    expect(traderAssistantInputSchema.safeParse({
      ...validInput,
      scenario: { ...validInput.scenario, outcomes: { target: 30, stop: 30, other: 30 } },
    }).success).toBe(false);
  });

  it("builds the model context only from bounded scenario values and the supplied conversation", () => {
    const messages = buildTraderAssistantMessages(validInput);
    const joined = messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");
    expect(messages[0]).toMatchObject({ role: "system", content: TRADER_ASSISTANT_SYSTEM_PROMPT });
    expect(joined).toContain("синтетические");
    expect(joined).toContain("XAUUSD");
    expect(joined).toMatch(/10\s?000 прогонов/);
    expect(joined).toContain("Что означает риск?");
    expect(joined).toContain(validInput.prompt);
    expect(joined).not.toContain("localStorage");
    expect(joined).not.toContain("user key");
  });
});

describe("Skill Trader AI in-memory limiter", () => {
  it("limits each user to six requests in a rolling minute and keeps users separate", () => {
    const limiter = new TraderAssistantRateLimiter();
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    for (let index = 0; index < 6; index += 1) {
      expect(limiter.consume("user-a", now + index)).toEqual({ allowed: true });
    }
    expect(limiter.consume("user-a", now + 10)).toMatchObject({ allowed: false, scope: "minute" });
    expect(limiter.consume("user-b", now + 10)).toEqual({ allowed: true });
    expect(limiter.consume("user-a", now + 60_001)).toEqual({ allowed: true });
  });

  it("caps requests per UTC day and resets on the next UTC day", () => {
    const limiter = new TraderAssistantRateLimiter();
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let index = 0; index < 80; index += 1) {
      expect(limiter.consume("daily-user", start + index * 61_000)).toEqual({ allowed: true });
    }
    expect(limiter.consume("daily-user", start + 80 * 61_000)).toMatchObject({ allowed: false, scope: "day" });
    expect(limiter.consume("daily-user", Date.UTC(2026, 0, 2, 0, 0, 0))).toEqual({ allowed: true });
  });

  it("bounds tracked users and clears expired user state on the next UTC day", () => {
    const limiter = new TraderAssistantRateLimiter(2);
    const start = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(limiter.consume("user-a", start)).toEqual({ allowed: true });
    expect(limiter.consume("user-b", start + 1)).toEqual({ allowed: true });
    expect(limiter.consume("user-c", start + 2)).toMatchObject({ allowed: false, scope: "capacity" });
    expect(limiter.consume("user-c", Date.UTC(2026, 0, 2, 0, 0, 0))).toEqual({ allowed: true });
  });
});
