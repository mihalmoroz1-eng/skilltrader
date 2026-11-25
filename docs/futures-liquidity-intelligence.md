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

## Safety
Public endpoints only. No API keys, private account routes, trade signals, order placement or execution. All results have executionEligible=false.
