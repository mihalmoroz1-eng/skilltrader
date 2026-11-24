# Market Data Intelligence

## Scope

This module introduces a server-side, read-only market-data foundation. The first provider is Binance Spot public REST klines. It does not require API keys, account permissions, or trading credentials and cannot place orders.

The existing UI simulation remains synthetic. This module is not yet connected to the dashboard, scenario engine, signal pipeline, or any execution path.

## Data flow

`MarketDataService` validates request parameters, checks the bounded TTL cache, calls the selected `MarketDataProvider`, normalizes the provider payload, validates the canonical OHLCV candles, and returns a snapshot with source and freshness metadata.

- Provider: `providers/BinanceSpotProvider.ts`
- Shared contracts: `core/MarketDataTypes.ts`
- Normalization: `core/MarketDataNormalizer.ts`
- Validation: `core/MarketDataValidator.ts`
- TTL cache: `core/MarketDataCache.ts`
- Orchestration: `services/MarketDataService.ts`

## Binance Spot source

The provider calls the public `GET /api/v3/klines` endpoint on `https://api.binance.com`. It sends no API key, signature, account data, or order request. The provider has a bounded request timeout and reports HTTP/rate-limit failures as typed errors. It does not silently retry.

Supported intervals and the maximum request size follow the Binance Spot kline API shape. The service accepts limits from 1 to 1,000 candles and normalizes symbols to uppercase.

## Data integrity

Incoming payloads are treated as untrusted. The normalizer rejects malformed rows and non-finite numeric fields. The validator rejects empty datasets, non-positive prices, negative volumes, invalid trade counts, impossible OHLC ranges, duplicate timestamps, and out-of-order candles.

The cache is in-memory, bounded by entry count, and uses a configurable TTL (5 seconds by default). Cache hits are explicitly marked `freshness: "cached"`; network responses are marked `freshness: "live"`. A cache hit is not a new exchange fetch.

## Limitations and safety

- Public market-data access is subject to Binance availability, geographic restrictions, and rate limits.
- A successful HTTP response does not prove that a candle is closed; consumers must inspect candle timestamps before treating the latest candle as final.
- In-memory cache entries are lost on process restart and are not shared across server instances.
- This module is not yet exposed through tRPC or the client UI.
- No historical backfill, websocket stream, news feed, exchange account connection, trading signal, paper order, or live order is implemented here.
- Provider output must not be described as investment advice or a guaranteed forecast.

## Verification

Unit tests cover normalization, validation, cache TTL/defensive copies/eviction, provider request shape and HTTP rate-limit handling, and service parameter validation/cache behavior. Run:

```bash
pnpm check
pnpm test
pnpm build
```

The GitHub Actions workflow is expected to verify Node.js 22 and 24. A local or source-level review is not a substitute for a completed green CI run.
