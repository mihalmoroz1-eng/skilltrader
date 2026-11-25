import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCaller(openId: string | null) {
  const now = new Date();
  const user: AuthenticatedUser | null = openId ? {
    id: 1,
    openId,
    email: "market-data-test@example.com",
    name: "Market Data Test",
    loginMethod: "test",
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  } : null;

  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

const candleRow = [
  1_700_000_000_000,
  "100.000000000000000001",
  "105",
  "99",
  "103",
  "12.5",
  1_700_000_059_999,
  "1287.5",
  42,
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("protected market data tRPC query", () => {
  it("fetches public candles once and serves subsequent calls from the shared cache", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([candleRow]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", request);

    const caller = createCaller("market-data-cache-user");
    const first = await caller.marketData.candles({ symbol: " tSTusdt ", interval: "1m", limit: 1 });
    const second = await caller.marketData.candles({ symbol: "TSTUSDT", interval: "1m", limit: 1 });

    expect(first.source).toBe("binance-spot");
    expect(first.freshness).toBe("live");
    expect(first.candles[0].open).toBe("100.000000000000000001");
    expect(second.freshness).toBe("cached");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("requires an authenticated user", async () => {
    await expect(createCaller(null).marketData.candles({ symbol: "TST2USDT", interval: "1m", limit: 1 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects invalid input before calling the exchange", async () => {
    const request = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", request);

    await expect(createCaller("market-data-invalid-user").marketData.candles({
      symbol: "BTC/USDT",
      interval: "1m",
      limit: 1,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(request).not.toHaveBeenCalled();
  });

  it("maps the exchange rate limit to a safe tRPC error", async () => {
    const request = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", request);

    await expect(createCaller("market-data-rate-limit-user").marketData.candles({
      symbol: "LIMITUSDT",
      interval: "1m",
      limit: 1,
    })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Биржа ограничила частоту запросов. Повторите позже.",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
