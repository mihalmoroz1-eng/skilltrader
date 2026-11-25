import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";

function createAnonymousCaller() {
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

describe("protected market intelligence route", () => {
  it("rejects unauthenticated requests before running market or AI agents", async () => {
    await expect(createAnonymousCaller().marketIntelligence.analyze({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 96,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
