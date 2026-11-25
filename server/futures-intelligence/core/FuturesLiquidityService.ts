import type { FuturesLiquidityResult, FuturesMarketProvider, FuturesOrderBookLevel, FuturesRawSnapshot } from "./FuturesLiquidityTypes";

export class FuturesLiquidityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FuturesLiquidityValidationError";
  }
}

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
function decimal(value: unknown, name: string, allowNegative = false): number {
  if (typeof value !== "string" || value.length > 40 || !DECIMAL.test(value) || (!allowNegative && value.startsWith("-"))) {
    throw new FuturesLiquidityValidationError(`${name} must be a bounded decimal string`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (!allowNegative && parsed <= 0)) {
    throw new FuturesLiquidityValidationError(`${name} is outside the supported numeric range`);
  }
  return parsed;
}

function validateLevels(levels: FuturesOrderBookLevel[], side: "bid" | "ask"): number[] {
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 1000) {
    throw new FuturesLiquidityValidationError(`${side} book levels are invalid`);
  }
  const prices: number[] = [];
  let previous: number | null = null;
  for (const [index, level] of levels.entries()) {
    if (!level || typeof level !== "object") throw new FuturesLiquidityValidationError(`${side} level ${index} is invalid`);
    const price = decimal(level.price, `${side} price`);
    decimal(level.quantity, `${side} quantity`);
    if (previous !== null && (side === "bid" ? price > previous : price < previous)) {
      throw new FuturesLiquidityValidationError(`${side} levels are not price sorted`);
    }
    previous = price;
    prices.push(price);
  }
  return prices;
}

function depthNotional(levels: FuturesOrderBookLevel[], mid: number, bandBps: number, side: "bid" | "ask"): number {
  const boundary = side === "bid" ? mid * (1 - bandBps / 10_000) : mid * (1 + bandBps / 10_000);
  return levels.reduce((total, level) => {
    const price = Number(level.price);
    if (side === "bid" ? price < boundary : price > boundary) return total;
    return total + price * Number(level.quantity);
  }, 0);
}

export class FuturesLiquidityService {
  constructor(private readonly provider: FuturesMarketProvider) {
    if (!provider?.id?.trim()) throw new Error("Futures provider id is required");
  }

  async analyze(symbolInput: string, depthLimit = 100): Promise<FuturesLiquidityResult> {
    if (typeof symbolInput !== "string") throw new FuturesLiquidityValidationError("Invalid symbol");
    const symbol = symbolInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(symbol) || !Number.isInteger(depthLimit) || depthLimit < 5 || depthLimit > 1000) {
      throw new FuturesLiquidityValidationError("Invalid futures request");
    }
    const snapshot = await this.provider.fetchSnapshot(symbol, depthLimit);
    return this.analyzeSnapshot(snapshot, depthLimit);
  }

  analyzeSnapshot(snapshot: FuturesRawSnapshot, expectedDepth = 100): FuturesLiquidityResult {
    if (!snapshot || snapshot.symbol !== snapshot.symbol?.toUpperCase() ||
        !/^[A-Z0-9]{2,20}$/.test(snapshot.symbol) ||
        typeof snapshot.source !== "string" || !snapshot.source.trim() ||
        !Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt < 0 ||
        !Number.isSafeInteger(snapshot.orderBook.lastUpdateId) || snapshot.orderBook.lastUpdateId < 0 ||
        snapshot.orderBook.bids.length > expectedDepth || snapshot.orderBook.asks.length > expectedDepth) {
      throw new FuturesLiquidityValidationError("Futures snapshot metadata is invalid");
    }
    const bids = validateLevels(snapshot.orderBook.bids, "bid");
    const asks = validateLevels(snapshot.orderBook.asks, "ask");
    const bestBid = bids[0];
    const bestAsk = asks[0];
    if (bestBid >= bestAsk) throw new FuturesLiquidityValidationError("Order book is crossed or locked");
    const mid = (bestBid + bestAsk) / 2;
    const spreadBps = (bestAsk - bestBid) / mid * 10_000;
    const mark = decimal(snapshot.markPrice, "markPrice");
    const index = decimal(snapshot.indexPrice, "indexPrice");
    const funding = decimal(snapshot.fundingRate, "fundingRate", true);
    decimal(snapshot.openInterest, "openInterest");
    if (!Number.isSafeInteger(snapshot.nextFundingTime) || snapshot.nextFundingTime < 0) {
      throw new FuturesLiquidityValidationError("nextFundingTime is invalid");
    }

    const depth = [10, 25, 50].map(bandBps => {
      const bidNotional = depthNotional(snapshot.orderBook.bids, mid, bandBps, "bid");
      const askNotional = depthNotional(snapshot.orderBook.asks, mid, bandBps, "ask");
      const total = bidNotional + askNotional;
      return { bandBps, bidNotional, askNotional, imbalance: total > 0 ? (bidNotional - askNotional) / total : 0 };
    });
    const imbalance = depth[1].imbalance;
    const fundingBias = Math.abs(funding) < 0.00001 ? "neutral" : funding > 0 ? "positive" : "negative";
    return {
      symbol: snapshot.symbol, source: snapshot.source, fetchedAt: snapshot.fetchedAt,
      orderBook: {
        lastUpdateId: snapshot.orderBook.lastUpdateId,
        bestBid: snapshot.orderBook.bids[0].price, bestAsk: snapshot.orderBook.asks[0].price,
        midPrice: String(mid), spreadBps,
        levels: { bids: snapshot.orderBook.bids.length, asks: snapshot.orderBook.asks.length },
      },
      depth,
      futures: {
        markPrice: snapshot.markPrice, indexPrice: snapshot.indexPrice,
        markIndexBasisBps: (mark - index) / index * 10_000,
        fundingRate: snapshot.fundingRate, fundingBias,
        nextFundingTime: snapshot.nextFundingTime, openInterest: snapshot.openInterest,
      },
      interpretation: {
        liquidity: spreadBps < 2 ? "tight" : spreadBps < 8 ? "normal" : "wide",
        bookBias: imbalance > 0.15 ? "bid_dominant" : imbalance < -0.15 ? "ask_dominant" : "balanced",
      },
      warnings: [
        "Public USD-M Futures snapshot only; no private account or order endpoints are used.",
        "REST depth is a point-in-time book snapshot, not a synchronized execution-quality guarantee.",
        "Depth is limited to the requested top levels and does not model hidden liquidity, queue position or market impact.",
        "Funding rate and open interest are context metrics, not directional trade signals.",
      ],
      executionEligible: false,
    };
  }
}
