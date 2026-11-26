# Historical Liquidity Backtesting

## Current implementation boundary

The historical order-book archive is populated through explicit user-triggered capture. The Futures Research panel supports a bounded foreground session (15/30/60-second cadence, up to 60 snapshots) while the page remains open and visible. It is not a background collector, and no snapshot is backfilled from a current REST response. The archive must be queried and its coverage measured before it can be used to assess historical fills.

This stage introduces two deterministic, read-only primitives:

- **Coverage analysis** matches each next-candle-open decision timestamp to the latest archived snapshot whose local `observedAt` is less than or equal to that timestamp. A snapshot is usable only within the configured age limit (maximum 300 seconds). Future snapshots are never eligible.
- **Liquidity fill simulation** consumes asks for BUY and bids for SELL, walks visible price levels, and calculates visible-depth VWAP, quoted spread and market impact using fixed-point `BigInt` decimal arithmetic.

A requested fill is returned only when the full requested quantity is available within the archived visible levels. Stale snapshots and insufficient visible depth return unavailable prices; partial quantities are not silently treated as full fills.

## Access and diagnostics

The authenticated `backtesting.liquidityCoverage` endpoint reads saved closed candles and archived order-book snapshots only; it does not call Binance or collect new data. The Walk-Forward panel exposes a manual coverage check for the selected symbol, interval and date range. It reports matched, stale and missing decision timestamps, coverage percentage, snapshot count and matched-snapshot age. Ranges with more than 5,000 archived snapshots must be narrowed rather than silently truncated.

## Timing and limitations

Strategy signals are known only after the preceding candle closes. The existing backtest executor enters at the next candle open, so coverage is evaluated at that next candle's `openTime`. This is a causal reference-time convention, not proof that an archived snapshot was continuously valid at the exact exchange matching instant.

OHLC stop-loss / take-profit triggers can occur intrabar. Candle data does not reveal their exact event timestamp or contemporaneous order book. The current primitives therefore do not claim liquidity-aware intrabar stop/target execution.

## Safety and data integrity

- Archived snapshots are used only at or before the decision timestamp.
- No current/live order book is ever used as a historical substitute.
- Missing, stale, corrupt, or insufficient depth is unavailable; no interpolation or synthetic depth is permitted.
- Decimal prices and quantities are processed with fixed-point `BigInt`; precision beyond 18 decimal places is rejected.
- Results are research-only: `executionEligible=false`, `exchangeOrderSent=false`.
- These primitives are not yet wired into the production Backtest Engine or the four-strategy Walk-Forward comparison. Integration is gated on real archive coverage evidence and additional end-to-end validation.
