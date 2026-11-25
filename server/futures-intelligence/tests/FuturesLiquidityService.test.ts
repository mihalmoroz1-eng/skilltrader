import { describe, expect, it, vi } from "vitest";
import { FuturesLiquidityService, FuturesLiquidityValidationError } from "../core/FuturesLiquidityService";
import type { FuturesMarketProvider, FuturesRawSnapshot } from "../core/FuturesLiquidityTypes";

const snapshot: FuturesRawSnapshot = {
  symbol: "BTCUSDT", source: "binance-usdm-futures", fetchedAt: 1_700_000_000_000,
  orderBook: {
    lastUpdateId: 123,
    bids: [{ price: "100", quantity: "5" }, { price: "99.9", quantity: "8" }],
    asks: [{ price: "100.1", quantity: "4" }, { price: "100.2", quantity: "7" }],
  },
  markPrice: "100.05", indexPrice: "100.00", fundingRate: "0.0001",
  nextFundingTime: 1_700_028_800_000, openInterest: "12000.5",
};
function service(raw = snapshot) {
  const provider: FuturesMarketProvider = { id: "binance-usdm-futures", fetchSnapshot: vi.fn(async () => raw) };
  return new FuturesLiquidityService(provider);
}

describe("Futures Liquidity Intelligence", () => {
  it("calculates spread, depth imbalance and futures context", async () => {
    const result = await service().analyze("btcusdt", 100);
    expect(result.symbol).toBe("BTCUSDT");
    expect(result.orderBook.spreadBps).toBeGreaterThan(0);
    expect(result.depth).toHaveLength(3);
    expect(result.futures.fundingBias).toBe("positive");
    expect(result.executionEligible).toBe(false);
  });

  it("rejects crossed order books", () => {
    const crossed = { ...snapshot, orderBook: { ...snapshot.orderBook, bids: [{ price: "101", quantity: "1" }] } };
    expect(() => service(crossed).analyzeSnapshot(crossed)).toThrow(FuturesLiquidityValidationError);
  });

  it("rejects unsorted or malformed levels", () => {
    const unsorted = { ...snapshot, orderBook: { ...snapshot.orderBook, bids: [
      { price: "99", quantity: "1" }, { price: "100", quantity: "1" },
    ] } };
    expect(() => service(unsorted).analyzeSnapshot(unsorted)).toThrow(/not price sorted/);
  });

  it("rejects negative or non-decimal market values", () => {
    const malformed = { ...snapshot, markPrice: "-1" };
    expect(() => service(malformed).analyzeSnapshot(malformed)).toThrow(FuturesLiquidityValidationError);
  });

  it("rejects invalid symbols before provider access", async () => {
    const provider: FuturesMarketProvider = { id: "fixture", fetchSnapshot: vi.fn(async () => snapshot) };
    const svc = new FuturesLiquidityService(provider);
    await expect(svc.analyze("BTC/USDT")).rejects.toThrow(FuturesLiquidityValidationError);
    expect(provider.fetchSnapshot).not.toHaveBeenCalled();
  });
});
