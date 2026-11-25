import { createHash } from "node:crypto";
import type { MarketCandle, MarketInterval } from "../../market-data/core/MarketDataTypes";

export type MarketRegime = "uptrend" | "downtrend" | "ranging" | "high_volatility" | "transition";
export type MarketRegimeConfig = {
  symbol: string; interval: MarketInterval; lookback: number;
  trendThresholdBps: number; rangeThresholdBps: number; highVolatilityThresholdBps: number;
};
export type MarketRegimePoint = {
  time: number; regime: MarketRegime; confidence: number;
  netChangeBps: number; efficiencyRatio: number; averageTrueRangeBps: number;
};
export type MarketRegimeResult = {
  runId: string; dataDigest: string; symbol: string; interval: MarketInterval;
  candlesProcessed: number; lookback: number; current: MarketRegimePoint | null;
  distribution: Array<{ regime: MarketRegime; observations: number; sharePct: number }>;
  transitions: Array<{ from: MarketRegime; to: MarketRegime; time: number }>;
  history: MarketRegimePoint[]; warnings: string[];
  methodology: string[]; executionEligible: false; exchangeOrderSent: false;
};
export class MarketRegimeInputError extends Error {
  constructor(message: string) { super(message); this.name = "MarketRegimeInputError"; }
}

const FIXED_INTERVAL_MS: Partial<Record<MarketInterval, number>> = {
  "1m":60_000,"3m":180_000,"5m":300_000,"15m":900_000,"30m":1_800_000,
  "1h":3_600_000,"2h":7_200_000,"4h":14_400_000,"6h":21_600_000,
  "8h":28_800_000,"12h":43_200_000,"1d":86_400_000,"3d":259_200_000,"1w":604_800_000,
};
function stepFor(interval: MarketInterval, openTime: number): number {
  if (interval === "1M") {
    const d = new Date(openTime);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1) - openTime;
  }
  return FIXED_INTERVAL_MS[interval] ?? 0;
}
function finitePositive(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new MarketRegimeInputError("Candle contains an invalid or non-positive price");
  return n;
}
function classify(
  window: MarketCandle[], config: MarketRegimeConfig,
): Omit<MarketRegimePoint, "time"> {
  const first = finitePositive(window[0].close);
  const last = finitePositive(window[window.length-1].close);
  const netChangeBps = (last / first - 1) * 10_000;
  let path = 0;
  let trueRangeBps = 0;
  for (let i=1;i<window.length;i++) {
    const previous = finitePositive(window[i-1].close);
    const close = finitePositive(window[i].close);
    const high = finitePositive(window[i].high);
    const low = finitePositive(window[i].low);
    path += Math.abs(close / previous - 1) * 10_000;
    trueRangeBps += Math.max(high-low, Math.abs(high-previous), Math.abs(low-previous)) / previous * 10_000;
  }
  const efficiencyRatio = path > 0 ? Math.min(1, Math.abs(netChangeBps) / path) : 0;
  const averageTrueRangeBps = trueRangeBps / (window.length-1);
  let regime: MarketRegime;
  let confidence: number;
  if (averageTrueRangeBps >= config.highVolatilityThresholdBps) {
    regime = "high_volatility";
    confidence = Math.min(100, 50 + (averageTrueRangeBps / config.highVolatilityThresholdBps - 1) * 25);
  } else if (netChangeBps >= config.trendThresholdBps && efficiencyRatio >= 0.35) {
    regime = "uptrend";
    confidence = Math.min(100, 50 + Math.min(netChangeBps/config.trendThresholdBps-1, efficiencyRatio) * 25);
  } else if (netChangeBps <= -config.trendThresholdBps && efficiencyRatio >= 0.35) {
    regime = "downtrend";
    confidence = Math.min(100, 50 + Math.min(Math.abs(netChangeBps)/config.trendThresholdBps-1, efficiencyRatio) * 25);
  } else if (Math.abs(netChangeBps) <= config.rangeThresholdBps && efficiencyRatio <= 0.25) {
    regime = "ranging";
    confidence = Math.min(100, 50 + (1-efficiencyRatio) * 25);
  } else {
    regime = "transition";
    confidence = 50;
  }
  return {
    regime, confidence: Number.isFinite(confidence) ? Math.round(confidence*100)/100 : 50,
    netChangeBps: Number.isFinite(netChangeBps) ? Math.round(netChangeBps*100)/100 : 0,
    efficiencyRatio: Number.isFinite(efficiencyRatio) ? Math.round(efficiencyRatio*10_000)/10_000 : 0,
    averageTrueRangeBps: Number.isFinite(averageTrueRangeBps) ? Math.round(averageTrueRangeBps*100)/100 : 0,
  };
}

export function runMarketRegimeAnalysis(candles: MarketCandle[], config: MarketRegimeConfig): MarketRegimeResult {
  if (!Number.isInteger(config.lookback) || config.lookback < 10 || config.lookback > 200) {
    throw new MarketRegimeInputError("Lookback must be between 10 and 200 candles");
  }
  if (candles.length > 50_000) throw new MarketRegimeInputError("Market regime analysis is limited to 50,000 candles");
  if (candles.length < config.lookback + 1) {
    throw new MarketRegimeInputError(`Insufficient history: at least ${config.lookback+1} candles are required`);
  }
  const ordered = [...candles];
  for (let i=0;i<ordered.length;i++) {
    const c=ordered[i];
    if (!Number.isSafeInteger(c.openTime) || !Number.isSafeInteger(c.closeTime) || c.closeTime < c.openTime) {
      throw new MarketRegimeInputError("Candle timestamps are invalid");
    }
    const values=[c.open,c.high,c.low,c.close,c.volume,c.quoteVolume];
    if (values.some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) {
      throw new MarketRegimeInputError("Candle contains invalid numeric data");
    }
    const open=finitePositive(c.open), high=finitePositive(c.high), low=finitePositive(c.low), close=finitePositive(c.close);
    if (low > Math.min(open,close) || high < Math.max(open,close) || low > high) {
      throw new MarketRegimeInputError("Candle OHLC relationship is invalid");
    }
    if (i>0) {
      const expected=ordered[i-1].openTime+stepFor(config.interval,ordered[i-1].openTime);
      if (c.openTime !== expected) throw new MarketRegimeInputError("History contains a gap, duplicate or misaligned candle; analysis was withheld");
      if (c.openTime <= ordered[i-1].openTime) throw new MarketRegimeInputError("Candles are not strictly ordered");
    }
  }
  const history: MarketRegimePoint[]=[];
  for (let i=config.lookback;i<ordered.length;i++) {
    const window=ordered.slice(i-config.lookback,i+1);
    history.push({time:ordered[i].closeTime,...classify(window,config)});
  }
  const regimes: MarketRegime[]=["uptrend","downtrend","ranging","high_volatility","transition"];
  const counts=new Map<MarketRegime,number>(regimes.map(r=>[r,0]));
  for (const point of history) counts.set(point.regime,(counts.get(point.regime)??0)+1);
  const transitions: MarketRegimeResult["transitions"]=[];
  for (let i=1;i<history.length;i++) if (history[i].regime!==history[i-1].regime) {
    transitions.push({from:history[i-1].regime,to:history[i].regime,time:history[i].time});
  }
  const dataDigest=createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
  const runId=createHash("sha256").update(JSON.stringify({config,dataDigest})).digest("hex").slice(0,24);
  return {
    runId,dataDigest,symbol:config.symbol,interval:config.interval,candlesProcessed:ordered.length,
    lookback:config.lookback,current:history[history.length-1]??null,
    distribution:regimes.map(regime=>({regime,observations:counts.get(regime)??0,sharePct:history.length?(counts.get(regime)??0)/history.length*100:0})),
    transitions:transitions.slice(-100),history:history.slice(-500),
    warnings:["Confidence is a deterministic rule-strength score, not a probability of future price direction.","Regime labels describe completed historical candles only; no forecast, signal or trade recommendation is produced."],
    methodology:[
      "Classification uses a rolling close-to-close net move, path efficiency ratio and average true range over the configured lookback.",
      "High volatility takes precedence over directional and ranging classifications.",
      "Trend requires net movement beyond the configured basis-point threshold and efficiency ratio >= 0.35.",
      "Ranging requires absolute net movement within its threshold and efficiency ratio <= 0.25; all other observations are transition.",
      "Only exact consecutive candles are accepted. Gaps, duplicates, malformed OHLC values and insufficient history withhold the analysis; no candles are synthesized.",
      "Confidence is a bounded deterministic rule-strength score and is not statistically calibrated.",
      "Historical analysis only. It does not create signals, change risk limits, mutate PAPER positions or submit exchange orders.",
    ],
    executionEligible:false,exchangeOrderSent:false,
  };
}
