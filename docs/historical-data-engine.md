# Historical Data Engine

## Scope
The initial engine ingests Binance Spot OHLCV candles into the shared MySQL database and serves deterministic historical ranges. It does not create signals, size positions, or submit orders.

## Data contract
- Symbols are normalized uppercase and intervals use the shared market-data enum.
- Exchange price and volume fields remain decimal strings; no floating-point conversion is used for persistence.
- Each row records source and fetch timestamp.
- A unique key on symbol, interval, and open time prevents duplicate candle rows.
- Historical ranges are limited to 366 days per request; provider pages are capped at 1,000 rows.

## Quality controls
Every provider page is validated by the existing OHLCV validator. The ingestion service checks page ordering, pagination progress, duplicate conflicts, and missing interval gaps. Gaps are reported, not synthesized. The complete flag is false when a gap is detected or the returned range does not cover the requested edges.

## Storage
The historical_candles table is defined in drizzle/schema.ts and created by migration 0001_historical_candles.sql. Decimal values are stored as VARCHAR to preserve source representation. Database writes are idempotent on the unique candle key.

## Safety and limitations
- Public Binance Spot market data only; no API keys or private account endpoints.
- No futures, funding, trades, order book, or account history in this initial stage.
- No synthetic demo data is written to the historical market-data table.
- Database must be configured and migration applied before persistent ingestion is available.
- No order or execution capability is included.
