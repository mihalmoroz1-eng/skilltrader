import { describe, expect, it, vi } from "vitest";
import type { InvokeParams, InvokeResult } from "../../_core/llm";
import type { ProcessedMarketData } from "../../market-data/core/MarketDataProcessor";
import type { FuturesLiquidityResult } from "../../futures-intelligence/core/FuturesLiquidityTypes";
import { ResearchAgent, ResearchAgentOutputError, ResearchAgentTrustGateError } from "../core/ResearchAgent";

const now = 1_800_000_000_000;
function processed(): ProcessedMarketData {
  const interval = 900_000;
  const candles = Array.from({ length: 60 }, (_, i) => {
    const openTime = now - 60 * interval + i * interval;
    return { openTime, closeTime: openTime + interval - 1, open: "100", high: "102", low: "99", close: "101", volume: "20", quoteVolume: "2020", tradeCount: 12 };
  });
  return {
    symbol: "BTCUSDT", interval: "15m", source: "binance-spot", fetchedAt: now - 1_000,
    freshness: "live", candles, processedAt: now,
    quality: { status: "ready", inputCandleCount: 60, closedCandleCount: 60, incompleteCandleCount: 0,
      gapCount: 0, estimatedMissingIntervals: 0, continuousSegments: 1, longestContinuousSegment: 60,
      minimumCandlesForFullIndicators: 50, gaps: [], warnings: [] },
    indicators: candles.map(c => ({ openTime: c.openTime, closeTime: c.closeTime, ema20: 100.5, ema50: 100,
      rsi14: 55, macdLine: 0.5, macdSignal: 0.3, macdHistogram: 0.2, atr14: 0.8, vwap: 100.2 })),
  };
}
function futures(): FuturesLiquidityResult {
  return {
    symbol: "BTCUSDT", source: "binance-usdm-futures", fetchedAt: now - 500,
    orderBook: { lastUpdateId: 123, bestBid: "100", bestAsk: "100.1", midPrice: "100.05",
      spreadBps: 1, levels: { bids: 100, asks: 100 } },
    depth: [10, 25, 50].map(bandBps => ({ bandBps, bidNotional: 100_000, askNotional: 90_000, imbalance: 0.05 })),
    futures: { markPrice: "100.05", indexPrice: "100", markIndexBasisBps: 5,
      fundingRate: "0.0001", fundingBias: "positive", nextFundingTime: now + 10_000, openInterest: "12000" },
    interpretation: { liquidity: "tight", bookBias: "balanced" },
    warnings: [], executionEligible: false,
  };
}
function invokeWith(payload: unknown, inspect?: (params: InvokeParams) => void) {
  const call = vi.fn(async (params: InvokeParams): Promise<InvokeResult> => {
    inspect?.(params);
    return { id: "fixture", created: 1, model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(payload) }, finish_reason: "stop" }] };
  });
  return call;
}
const goodOutput = { assessment: "constructive", evidenceCodes: ["spot_trend_bullish", "spread_tight", "book_balanced"], riskFlags: [] };

describe("Research Agent", () => {
  it("returns structured source-backed context and provenance", async () => {
    let paramsSeen: InvokeParams | undefined;
    const call = invokeWith(goodOutput, params => { paramsSeen = params; });
    const agent = new ResearchAgent(call, () => now);
    const result = await agent.analyze(processed(), futures());
    expect(result.assessment).toBe("constructive");
    expect(result.executionEligible).toBe(false);
    expect(result.provenance.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.provenance.researchDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(paramsSeen?.tools).toBeUndefined();
    expect(paramsSeen?.toolChoice).toBe("none");
    expect(paramsSeen?.maxRetries).toBe(0);
  });

  it("rejects stale Spot data before model access", async () => {
    const call = invokeWith(goodOutput);
    const input = processed();
    input.fetchedAt = now - 31_000;
    const agent = new ResearchAgent(call, () => now);
    await expect(agent.analyze(input, futures())).rejects.toBeInstanceOf(ResearchAgentTrustGateError);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects futures data for a different symbol", async () => {
    const call = invokeWith(goodOutput);
    const market = futures();
    market.symbol = "ETHUSDT";
    const agent = new ResearchAgent(call, () => now);
    await expect(agent.analyze(processed(), market)).rejects.toBeInstanceOf(ResearchAgentTrustGateError);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects model evidence that was not derived by the server", async () => {
    const call = invokeWith({ assessment: "constructive", evidenceCodes: ["spot_trend_bearish"], riskFlags: [] });
    const agent = new ResearchAgent(call, () => now);
    await expect(agent.analyze(processed(), futures())).rejects.toBeInstanceOf(ResearchAgentOutputError);
  });

  it("rejects invented risk flags", async () => {
    const call = invokeWith({ assessment: "cautionary", evidenceCodes: ["spot_trend_bullish"], riskFlags: ["thin_liquidity"] });
    const agent = new ResearchAgent(call, () => now);
    await expect(agent.analyze(processed(), futures())).rejects.toBeInstanceOf(ResearchAgentOutputError);
  });
});
