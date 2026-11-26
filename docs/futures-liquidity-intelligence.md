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


## Historical order-book archive

The authenticated `futuresIntelligence.captureHistoricalOrderBook` mutation captures and persists one validated public USD-M Futures depth snapshot. In the Futures Research panel, the user can also start a bounded foreground capture session: one snapshot immediately, then one after each selected 15-, 30- or 60-second delay, with a maximum of 60 snapshots per session. The user can stop the session; it also stops when the page is unmounted, the tab becomes hidden, or a capture fails. A request already in flight may complete after the user presses stop. The collector is client-driven, not a background service; it does not run when the page is closed or hidden, and no continuous coverage is guaranteed. The shared market-data rate limiter allows up to 20 requests per user per rolling minute across the market-data endpoints; other market-data requests consume the same budget. The 15-second cadence uses at most four capture requests per minute when requests complete promptly.

The `futures_order_book_snapshots` table stores symbol, provider, conservative local observation time, provider receipt time, Binance depth update ID, best quotes, bounded visible bid/ask levels as decimal-preserving JSON, level counts and a SHA-256 content digest. A unique key prevents duplicate observations for the same symbol, observation timestamp and update ID. The database index supports symbol/time-range retrieval.

The observation timestamp is assigned after the provider response has completed and validated. It is intentionally conservative: a snapshot can only be matched to a strategy decision when `observedAt <= decisionTime`. The service never selects a future observation. A caller may additionally require a maximum age; stale and missing matches are explicit statuses. Stored levels are revalidated and the digest is recomputed on read; corrupt records fail closed.

Protected endpoints:
- `captureHistoricalOrderBook`: fetch, validate and store one snapshot.
- `historicalOrderBook`: read a bounded time range (maximum 366 days and 5,000 rows).
- `matchHistoricalOrderBook`: return the latest snapshot at or before a supplied decision timestamp, with age and match status.

This archive is not yet automatically populated, and current REST snapshots are not historical backfill. The Backtesting Engine does not yet apply archived depth to historical fills. Historical liquidity-aware backtests should remain unavailable until sufficient time-aligned observations exist and coverage, staleness and gap requirements are explicitly validated. No missing snapshots are interpolated or replaced with current liquidity.
