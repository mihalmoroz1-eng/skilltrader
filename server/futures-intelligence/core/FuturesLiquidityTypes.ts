export type FuturesOrderBookLevel = { price: string; quantity: string };

export type FuturesRawSnapshot = {
  symbol: string;
  source: string;
  fetchedAt: number;
  orderBook: {
    lastUpdateId: number;
    bids: FuturesOrderBookLevel[];
    asks: FuturesOrderBookLevel[];
  };
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: number;
  openInterest: string;
};

export type FuturesLiquidityResult = {
  symbol: string;
  source: string;
  fetchedAt: number;
  orderBook: {
    lastUpdateId: number;
    bestBid: string;
    bestAsk: string;
    midPrice: string;
    spreadBps: number;
    levels: { bids: number; asks: number };
  };
  depth: Array<{
    bandBps: number;
    bidNotional: number;
    askNotional: number;
    imbalance: number;
  }>;
  futures: {
    markPrice: string;
    indexPrice: string;
    markIndexBasisBps: number;
    fundingRate: string;
    fundingBias: "positive" | "negative" | "neutral";
    nextFundingTime: number;
    openInterest: string;
  };
  interpretation: {
    liquidity: "tight" | "normal" | "wide";
    bookBias: "bid_dominant" | "ask_dominant" | "balanced";
  };
  warnings: string[];
  executionEligible: false;
};

export interface FuturesMarketProvider {
  readonly id: string;
  fetchSnapshot(symbol: string, depthLimit: number): Promise<FuturesRawSnapshot>;
}
