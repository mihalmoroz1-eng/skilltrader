import { describe, expect, it } from "vitest";
import { runMarketRegimeAnalysis, MarketRegimeInputError } from "../core/MarketRegimeEngine";
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
  it("classifies a persistent rise as an uptrend",()=>{
    const result=runMarketRegimeAnalysis(candles(Array.from({length:31},(_,i)=>100+i*0.5)),config);
    expect(result.current?.regime).toBe("uptrend");
    expect(result.executionEligible).toBe(false);
    expect(result.exchangeOrderSent).toBe(false);
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
  it("rejects malformed OHLC and returns deterministic output",()=>{
    const input=candles(Array.from({length:31},(_,i)=>100+i*0.1));
    expect(runMarketRegimeAnalysis(input,config).runId).toBe(runMarketRegimeAnalysis(input,config).runId);
    expect(()=>runMarketRegimeAnalysis([{...input[0],high:"1"},...input.slice(1)],config)).toThrow(/OHLC/);
  });
});
