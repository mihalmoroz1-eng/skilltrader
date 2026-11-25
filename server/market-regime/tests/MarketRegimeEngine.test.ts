import { describe, expect, it } from "vitest";
import { runMarketRegimeAnalysis, MarketRegimeInputError } from "../core/MarketRegimeEngine";
import { classifyMarketRegimeWindow } from "../core/MarketRegimeClassifier";
import type { MarketCandle } from "../../market-data/core/MarketDataTypes";

function candles(closes:number[], intervalStep=60_000):MarketCandle[] {
  return closes.map((close,i)=>{
    const previous=i?closes[i-1]:close;
    const high=Math.max(close,previous)*1.001, low=Math.min(close,previous)*0.999;
    return {openTime:i*intervalStep,closeTime:(i+1)*intervalStep-1,open:String(previous),high:String(high),low:String(low),close:String(close),volume:"10",quoteVolume:"10",tradeCount:1};
  });
}
const config={symbol:"BTCUSDT",interval:"1m" as const,lookback:10,trendThresholdBps:100,rangeThresholdBps:50,highVolatilityThresholdBps:200};

describe("Market Regime Engine",()=>{
  it("uses the same canonical classifier for a standalone window and rolling history", () => {
    const input = candles(Array.from({ length: 31 }, (_, i) => 100 + i * 0.5));
    const analysis = runMarketRegimeAnalysis(input, config);
    const direct = classifyMarketRegimeWindow(input.slice(-11), {
      interval: config.interval,
      lookback: config.lookback,
      trendThresholdBps: config.trendThresholdBps,
      rangeThresholdBps: config.rangeThresholdBps,
      highVolatilityThresholdBps: config.highVolatilityThresholdBps,
    });
    expect(analysis.current?.regime).toBe(direct.regime);
    expect(analysis.current?.confidence).toBe(direct.confidence);
    expect(analysis.current?.netChangeBps).toBe(direct.netChangeBps);
  });

  it("rejects windows with a candle that does not close on the interval boundary", () => {
    const input = candles(Array.from({ length: 11 }, (_, i) => 100 + i * 0.2));
    input[5] = { ...input[5], closeTime: input[5].closeTime - 1 };
    expect(() => classifyMarketRegimeWindow(input, {
      interval: config.interval,
      lookback: config.lookback,
      trendThresholdBps: config.trendThresholdBps,
      rangeThresholdBps: config.rangeThresholdBps,
      highVolatilityThresholdBps: config.highVolatilityThresholdBps,
    })).toThrow(/close time/);
  });

  it("classifies a persistent rise as an uptrend",()=>{
    const result=runMarketRegimeAnalysis(candles(Array.from({length:31},(_,i)=>100+i*0.5)),config);
    expect(result.current?.regime).toBe("uptrend");
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
  });
  it("classifies a persistent decline as a downtrend",()=>{
    const result=runMarketRegimeAnalysis(candles(Array.from({length:31},(_,i)=>100-i*0.5)),config);
    expect(result.current?.regime).toBe("downtrend");
  });
  it("classifies a weak but directional move as transition",()=>{
    const result=runMarketRegimeAnalysis(candles(Array.from({length:31},(_,i)=>100+i*0.005)),config);
    expect(result.current?.regime).toBe("transition");
  });
  it("classifies low movement as ranging",()=>{
    const values=Array.from({length:31},(_,i)=>100+(i%2?0.02:-0.02));
    expect(runMarketRegimeAnalysis(candles(values),config).current?.regime).toBe("ranging");
  });
  it("classifies wide candles as high volatility",()=>{
    const values=Array.from({length:31},(_,i)=>100+(i%2?0.1:-0.1));
    const wide=candles(values).map(c=>({...c,high:String(Number(c.high)+3),low:String(Math.max(0.01,Number(c.low)-3))}));
    expect(runMarketRegimeAnalysis(wide,config).current?.regime).toBe("high_volatility");
  });
  it("withholds analysis on gaps and insufficient history",()=>{
    const gap=candles(Array.from({length:31},(_,i)=>100+i*0.1));
    gap[15]={...gap[15],openTime:gap[15].openTime+60_000};
    expect(()=>runMarketRegimeAnalysis(gap,config)).toThrow(MarketRegimeInputError);
    expect(()=>runMarketRegimeAnalysis(candles([100,101]),config)).toThrow(/Insufficient history/);
  });
  it("rejects invalid thresholds and interval candle boundaries",()=>{
    expect(()=>runMarketRegimeAnalysis(candles(Array.from({length:31},(_,i)=>100+i*0.1)),{...config,rangeThresholdBps:100})).toThrow(/thresholds/);
    const badCloseTime=candles(Array.from({length:31},(_,i)=>100+i*0.1));
    badCloseTime[10]={...badCloseTime[10],closeTime:badCloseTime[10].closeTime-1};
    expect(()=>runMarketRegimeAnalysis(badCloseTime,config)).toThrow(/close time/);
  });
  it("fails closed on non-finite intermediate arithmetic",()=>{
    const extreme=Array.from({length:11},(_,i)=>{
      const previous=i===0?1e-300:1e300, close=i===0?1e-300:1e300;
      return {openTime:i*60_000,closeTime:(i+1)*60_000-1,open:String(previous),high:String(Math.max(previous,close)*1.001),low:String(Math.min(previous,close)*0.999),close:String(close),volume:"1",quoteVolume:"1",tradeCount:1};
    });
    expect(()=>runMarketRegimeAnalysis(extreme,config)).toThrow(/Non-finite/);
  });
  it("rejects malformed OHLC and returns deterministic output",()=>{
    const input=candles(Array.from({length:31},(_,i)=>100+i*0.1));
    expect(runMarketRegimeAnalysis(input,config).runId).toBe(runMarketRegimeAnalysis(input,config).runId);
    expect(()=>runMarketRegimeAnalysis([{...input[0],high:"1"},...input.slice(1)],config)).toThrow(/OHLC/);
  });
});
