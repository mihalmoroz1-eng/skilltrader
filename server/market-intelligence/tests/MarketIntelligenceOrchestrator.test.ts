import { describe, expect, it, vi } from "vitest";
import type { InvokeParams, InvokeResult } from "../../_core/llm";
import { MarketIntelligenceOrchestrator, MarketIntelligenceTrustGateError, MarketIntelligenceAgentOutputError } from "../core/MarketIntelligenceOrchestrator";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";
import type { ProcessedMarketData } from "../../market-data/core/MarketDataProcessor";

const INTERVAL_MS = 15 * 60 * 1_000;

function createProcessed(now: number, includeFormingCandle = false): ProcessedMarketData {
  const start = now - 60 * INTERVAL_MS;
  const candles: MarketCandle[] = Array.from({ length: 60 }, (_, index) => {
    const open = 100 + index / 10;
    const close = open + 0.05;
    const openTime = start + index * INTERVAL_MS;
    return {
      openTime,
      closeTime: openTime + INTERVAL_MS - 1,
      open: String(open),
      high: String(close + 0.5),
      low: String(open - 0.5),
      close: String(close),
      volume: "10",
      quoteVolume: String(close * 10),
      tradeCount: 10,
    };
  });

  const processed: ProcessedMarketData = {
    symbol: "BTCUSDT",
    interval: "15m",
    source: "binance-spot",
    fetchedAt: now - 1_000,
    freshness: "live",
    candles: [...candles],
    processedAt: now,
    quality: {
      status: "ready",
      inputCandleCount: 60,
      closedCandleCount: 60,
      incompleteCandleCount: 0,
      gapCount: 0,
      estimatedMissingIntervals: 0,
      continuousSegments: 1,
      longestContinuousSegment: 60,
      minimumCandlesForFullIndicators: 50,
      gaps: [],
      warnings: [],
    },
    indicators: candles.map((candle) => ({
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      ema20: 109,
      ema50: 107,
      rsi14: 60,
      macdLine: 1,
      macdSignal: 0.7,
      macdHistogram: 0.3,
      atr14: 0.6,
      vwap: 108,
    })),
  };

  if (includeFormingCandle) {
    const openTime = now - (now % INTERVAL_MS);
    processed.candles.push({
      openTime,
      closeTime: openTime + INTERVAL_MS - 1,
      open: "900",
      high: "901",
      low: "899",
      close: "900.5",
      volume: "1000",
      quoteVolume: "900500",
      tradeCount: 20,
    });
    processed.quality.inputCandleCount = 61;
    processed.quality.incompleteCandleCount = 1;
  }

  return processed;
}

function result(payload: unknown, model: string): InvokeResult {
  return {
    id: `test-${model}`,
    created: 1,
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(payload) },
      finish_reason: "stop",
    }],
  };
}

function responseForAgent(agent: string): unknown {
  if (agent.includes("Market Agent")) {
    return { regime: "uptrend", momentum: "positive", evidenceCodes: ["ema20_above_ema50", "trend_structure_up"] };
  }
  if (agent.includes("Strategy Context Agent")) {
    return { context: "trend_context", evidenceCodes: ["ema20_above_ema50", "trend_structure_up"] };
  }
  if (agent.includes("Risk Context Agent")) {
    return { regime: "normal", riskEvidenceCodes: ["atr_ratio_0_5_to_2_percent"] };
  }
  return { verdict: "consistent", conflictCodes: [] };
}

function fakeModelCall(overrides?: {
  critic?: unknown;
  market?: unknown;
  onCall?: (params: InvokeParams) => void;
}) {
  return vi.fn(async (params: InvokeParams) => {
    overrides?.onCall?.(params);
    const systemMessage = params.messages[0]?.content;
    const systemText = typeof systemMessage === "string" ? systemMessage : "";
    const agent = systemText.includes("Market Agent")
      ? "market"
      : systemText.includes("Strategy Context Agent")
        ? "strategy"
        : systemText.includes("Risk Context Agent")
          ? "risk"
          : "critic";
    const payload = agent === "critic"
      ? overrides?.critic ?? responseForAgent(systemText)
      : agent === "market"
        ? overrides?.market ?? responseForAgent(systemText)
        : responseForAgent(systemText);
    return result(payload, `fixture-${agent}`);
  });
}

describe("trust-gated market intelligence orchestrator", () => {
  it("runs three independent agents and a critic with provenance, but no trade signal", async () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    const call = fakeModelCall();
    const orchestrator = new MarketIntelligenceOrchestrator(call, () => now, () => "fixed-run-id");

    const output = await orchestrator.analyze(createProcessed(now));

    expect(call).toHaveBeenCalledTimes(4);
    expect(output.runId).toBe("fixed-run-id");
    expect(output.status).toBe("reviewable");
    expect(output.market.regime).toBe("uptrend");
    expect(output.strategy.context).toBe("trend_context");
    expect(output.risk.regime).toBe("normal");
    expect(output.critic.verdict).toBe("consistent");
    expect(output.provenance.source).toBe("binance-spot");
    expect(output.provenance.promptVersion).toBe("2026-11-24.1");
    expect(output.provenance.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(output.noTradeSignalGenerated).toBe(true);
    expect(output.noOrderExecuted).toBe(true);

    for (const params of call.mock.calls.map((entry) => entry[0])) {
      expect(params.tools).toBeUndefined();
      expect(params.toolChoice).toBe("none");
      expect(params.maxRetries).toBe(0);
      expect(params.timeoutMs).toBe(20_000);
    }
  });

  it("does not invoke any agent when market data is stale or degraded", async () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    const call = fakeModelCall();
    const orchestrator = new MarketIntelligenceOrchestrator(call, () => now);

    const stale = createProcessed(now);
    stale.fetchedAt = now - 31_000;
    await expect(orchestrator.analyze(stale)).rejects.toBeInstanceOf(MarketIntelligenceTrustGateError);

    const degraded = createProcessed(now);
    degraded.quality.status = "degraded";
    degraded.quality.gapCount = 1;
    await expect(orchestrator.analyze(degraded)).rejects.toBeInstanceOf(MarketIntelligenceTrustGateError);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects unapproved sources, insufficient history and misaligned indicator arrays", async () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    const call = fakeModelCall();
    const orchestrator = new MarketIntelligenceOrchestrator(call, () => now);

    const unapproved = createProcessed(now);
    unapproved.source = "unverified-provider";
    await expect(orchestrator.analyze(unapproved)).rejects.toBeInstanceOf(MarketIntelligenceTrustGateError);

    const insufficient = createProcessed(now);
    insufficient.quality.closedCandleCount = 49;
    await expect(orchestrator.analyze(insufficient)).rejects.toBeInstanceOf(MarketIntelligenceTrustGateError);

    const misaligned = createProcessed(now);
    misaligned.indicators.pop();
    await expect(orchestrator.analyze(misaligned)).rejects.toBeInstanceOf(MarketIntelligenceTrustGateError);
    expect(call).not.toHaveBeenCalled();
  });

  it("marks critic disagreements as inconclusive rather than manufacturing a consensus", async () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    const call = fakeModelCall({
      critic: { verdict: "contradictory", conflictCodes: ["market_strategy_disagreement"] },
    });
    const orchestrator = new MarketIntelligenceOrchestrator(call, () => now);
    const output = await orchestrator.analyze(createProcessed(now));

    expect(output.status).toBe("inconclusive");
    expect(output.critic.conflictCodes).toContain("market_strategy_disagreement");
    expect(output.warnings.some((warning) => warning.includes("inconclusive"))).toBe(true);
  });

  it("rejects model evidence codes not present in server-derived evidence", async () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    const call = fakeModelCall({
      market: { regime: "uptrend", momentum: "positive", evidenceCodes: ["rsi_overbought"] },
    });
    const orchestrator = new MarketIntelligenceOrchestrator(call, () => now);

    await expect(orchestrator.analyze(createProcessed(now))).rejects.toBeInstanceOf(MarketIntelligenceAgentOutputError);
  });

  it("uses the last closed candle, not a forming candle, as the agent context", async () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    let capturedFacts: Record<string, unknown> | undefined;
    const call = fakeModelCall({
      onCall: (params) => {
        if (capturedFacts) return;
        const raw = params.messages[1]?.content;
        const text = typeof raw === "string" ? raw : "";
        const json = text.slice(text.indexOf("{"));
        capturedFacts = JSON.parse(json) as Record<string, unknown>;
      },
    });
    const orchestrator = new MarketIntelligenceOrchestrator(call, () => now);
    const processed = createProcessed(now, true);
    const closedLastClose = processed.candles[59].close;

    const output = await orchestrator.analyze(processed);
    const latest = capturedFacts?.latestClosedCandle as { close?: string } | undefined;

    expect(latest?.close).toBe(closedLastClose);
    expect(latest?.close).not.toBe("900.5");
    expect(output.provenance.closedCandleCount).toBe(60);
  });
});
