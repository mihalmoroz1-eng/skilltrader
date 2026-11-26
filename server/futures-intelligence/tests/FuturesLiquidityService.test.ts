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
function service(raw = snapshot, now = raw.fetchedAt) {
  const provider: FuturesMarketProvider = { id: "binance-usdm-futures", fetchSnapshot: vi.fn(async () => raw) };
  return new FuturesLiquidityService(provider, () => now);
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

  it("estimates BUY and SELL VWAP from the same visible order-book snapshot", async () => {
    const result = await service().simulateExecution("BTCUSDT", 600, 100);
    expect(result.buy.side).toBe("BUY");
    expect(result.sell.side).toBe("SELL");
    expect(result.buy.fullyFilled).toBe(true);
    expect(result.sell.fullyFilled).toBe(true);
    expect(result.buy.levelsConsumed).toBe(2);
    expect(result.sell.levelsConsumed).toBe(2);
    expect(result.buy.averageFillPrice).toBeGreaterThan(Number(snapshot.orderBook.asks[0].price));
    expect(result.sell.averageFillPrice).toBeLessThan(Number(snapshot.orderBook.bids[0].price));
    expect(result.buy.totalMidShortfallBps).toBeGreaterThan(0);
    expect(result.sell.totalMidShortfallBps).toBeGreaterThan(0);
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
  });

  it("reports insufficient visible depth as a partial fill, never a complete fill", async () => {
    const result = await service().simulateExecution("BTCUSDT", 2_000, 100);
    expect(result.buy.fullyFilled).toBe(false);
    expect(result.sell.fullyFilled).toBe(false);
    expect(result.buy.fillRatioPct).toBeLessThan(100);
    expect(result.sell.fillRatioPct).toBeLessThan(100);
    expect(result.buy.filledQuantity).toBeGreaterThan(0);
  });

  it("rejects stale, future-dated and mismatched order-book snapshots", async () => {
    await expect(service(snapshot, snapshot.fetchedAt + 30_001)
      .simulateExecution("BTCUSDT", 100)).rejects.toThrow(/stale/);
    await expect(service(snapshot, snapshot.fetchedAt - 5_001)
      .simulateExecution("BTCUSDT", 100)).rejects.toThrow(/stale/);
    const wrongSymbol = { ...snapshot, symbol: "ETHUSDT" };
    await expect(service(wrongSymbol).simulateExecution("BTCUSDT", 100)).rejects.toThrow(/symbol/);
  });

  it("rejects invalid notional and depth limits", async () => {
    await expect(service().simulateExecution("BTCUSDT", 0)).rejects.toThrow(FuturesLiquidityValidationError);
    await expect(service().simulateExecution("BTCUSDT", 10_000_001)).rejects.toThrow(FuturesLiquidityValidationError);
    await expect(service().simulateExecution("BTCUSDT", 100, 4)).rejects.toThrow(FuturesLiquidityValidationError);
  });

  it("rejects invalid symbols before provider access", async () => {
    const provider: FuturesMarketProvider = { id: "fixture", fetchSnapshot: vi.fn(async () => snapshot) };
    const svc = new FuturesLiquidityService(provider);
    await expect(svc.analyze("BTC/USDT")).rejects.toThrow(FuturesLiquidityValidationError);
    expect(provider.fetchSnapshot).not.toHaveBeenCalled();
  });
});
