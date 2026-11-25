import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCaller(openId: string | null) {
  const now = new Date();
  const user: AuthenticatedUser | null = openId ? {
    id: 1,
    openId,
    email: "market-analysis-test@example.com",
    name: "Market Analysis Test",
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

function createKlines(count: number): unknown[][] {
  const start = Date.UTC(2026, 0, 1);
  const intervalMs = 15 * 60 * 1_000;
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index / 10;
    const close = open + 0.05;
    const openTime = start + index * intervalMs;
    return [
      openTime,
      String(open),
      String(close + 0.5),
      String(open - 0.5),
      String(close),
      "10",
      openTime + intervalMs - 1,
      String(close * 10),
      12,
      "0",
      "0",
      "0",
    ];
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("protected deterministic market analysis query", () => {
  it("returns validated candles, data quality and indicators", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(createKlines(70)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCaller("analysis-query-user").marketData.analysis({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 70,
    });

    expect(result.source).toBe("binance-spot");
    expect(result.quality.status).toBe("ready");
    expect(result.quality.closedCandleCount).toBe(70);
    expect(result.indicators).toHaveLength(70);
    expect(result.indicators.at(-1)?.ema50).not.toBeNull();
    expect(result.indicators.at(-1)?.rsi14).not.toBeNull();
    expect(result.indicators.at(-1)?.macdHistogram).not.toBeNull();
    expect(result.indicators.at(-1)?.atr14).not.toBeNull();
    expect(result.indicators.at(-1)?.vwap).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires an authenticated session before analysis", async () => {
    await expect(createCaller(null).marketData.analysis({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 70,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
