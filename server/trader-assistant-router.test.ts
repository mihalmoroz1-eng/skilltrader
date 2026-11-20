import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { TraderAssistantInput } from "../shared/traderAssistant";
import { appRouter } from "./routers";

const input: TraderAssistantInput = {
  prompt: "Объясни условный риск сценария.",
  history: [],
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

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCaller(openId: string) {
  const now = new Date();
  const user: AuthenticatedUser = {
    id: 1,
    openId,
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

beforeEach(() => {
  vi.stubEnv("MANUS_API_URL", "https://api.example");
  vi.stubEnv("MANUS_API_KEY", "test-only");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Skill Trader AI retry classification", () => {
  it("does not offer the retryable service code for an unclassified application failure", async () => {
    const response = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error("unexpected response parsing failure")),
    } as unknown as Response;
    const request = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", request);

    await expect(createCaller("unexpected-error-user").traderAssistant.chat(input))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retains the retryable service code for a classified temporary upstream failure", async () => {
    const request = vi.fn().mockResolvedValue(new Response("temporary failure", { status: 503 }));
    vi.stubGlobal("fetch", request);

    await expect(createCaller("temporary-upstream-user").traderAssistant.chat(input))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
