# Futures & Liquidity Intelligence

## Scope
Initial public-only Binance USD-M Futures context module. It combines a REST order-book depth snapshot with mark/index price, current funding rate, next funding time and open interest.

## Metrics
- Best bid/ask, mid price and spread in basis points.
- Bid and ask notional depth within 10, 25 and 50 bps of mid.
- Depth imbalance within each band.
- Mark/index basis in basis points.
- Funding bias and open interest.
- Simple liquidity and order-book bias labels.

## Validation and limitations
Order-book levels must be positive decimal strings and sorted by price. Crossed/locked books, malformed metadata and invalid market values are rejected. Decimal strings are retained for exchange fields; derived depth totals and ratios use JavaScript number arithmetic and are descriptive estimates.

REST depth is a point-in-time snapshot, not a synchronized order-book stream. The module does not model hidden liquidity, queue position, market impact, liquidation, funding history, or account positions.


## Liquidity-aware execution simulation

The protected `futuresIntelligence.simulateExecution` endpoint estimates a hypothetical market BUY and SELL for the same requested USD notional using one freshly fetched public order-book snapshot.

- BUY consumes visible ask levels from best to worst; SELL consumes visible bid levels from best to worst.
- Requested base quantity is estimated as requested USD notional divided by the snapshot mid price.
- The result reports requested and filled quantity/notional, fill ratio, full-vs-partial availability, VWAP estimate, consumed levels, visible side depth, spread cost from mid to best quote, incremental depth impact beyond the best quote, and total mid-price shortfall in bps.
- Snapshot age is checked; snapshots older than 30 seconds or more than 5 seconds in the future are rejected. Request notional is bounded to 1–10,000,000 USDT and depth to 5–1,000 levels.
- Insufficient visible depth is explicitly returned as a partial fill; it is never presented as a completed order.
- No fees are included in this estimate. Fees remain part of the separate backtesting cost model.

This is a current-snapshot execution estimate, not a historical replay of strategy trades. Historical backtests do not yet have time-aligned archived order-book snapshots, so current liquidity is not applied retroactively to historical strategy returns.

The estimate does not model latency, queue priority, hidden liquidity, cancellations, replenishment, order-book changes during execution, or impact beyond the requested visible levels. It is not a guarantee of execution quality or an instruction to trade.

## Safety
Public endpoints only. No API keys, private account routes, trade signals, order placement or execution. All results have executionEligible=false.
