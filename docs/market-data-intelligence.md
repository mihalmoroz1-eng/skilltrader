# Market Data Intelligence

## Scope

This is a server-side, read-only market-data service. The first adapter uses Binance Spot public REST klines. It requires no API key, account permission, or trading credential and has no order-placement capability.

The service is available through the authenticated tRPC query `marketData.candles`. The dashboard and simulation remain synthetic; the live endpoint is not yet connected to the UI, scenario engine, signal pipeline, or execution path. The `android-demo` APK remains offline.

## Data flow

The shared Zod request schema validates and normalizes symbol, interval, and candle limit. The protected tRPC query applies a per-user rate limit, then `MarketDataService` checks the bounded TTL cache, calls a provider adapter, validates canonical candles, and returns a snapshot with source and freshness metadata.

- Request contract: `shared/marketData.ts`
- Provider contract: `server/market-data/core/MarketDataTypes.ts`
- Binance adapter and HTTP boundary: `server/market-data/providers/BinanceSpotProvider.ts`
- Binance payload normalizer: `server/market-data/core/MarketDataNormalizer.ts`
- Canonical data validator: `server/market-data/core/MarketDataValidator.ts`
- TTL cache: `server/market-data/core/MarketDataCache.ts`
- Provider-independent orchestration: `server/market-data/services/MarketDataService.ts`
- Per-user query limiter: `server/market-data/services/MarketDataRateLimiter.ts`
- tRPC integration: `server/routers.ts`

A future source implements `MarketDataProvider` and returns canonical `MarketCandle[]`; it does not expose its wire format to the service.

## API contract and access

The endpoint is a protected query; unauthenticated callers receive `UNAUTHORIZED`. The input schema accepts an alphanumeric symbol, a supported interval, and an optional limit from 1 to 1,000 (default 500). Symbols are trimmed and normalized to uppercase.

The per-user in-memory limiter permits 20 requests per minute and bounds tracking to 10,000 users per process. Requests served from cache also count toward this limit. This is a single-instance prototype control, not a distributed quota or a global IP limiter. Multi-instance/public operation requires a shared gateway quota or distributed limiter before exposure.

The tRPC handler maps upstream rate limits, network errors, malformed payloads, and invalid inputs to bounded error codes/messages. Provider details and raw upstream responses are not returned to clients.

## Precision and data integrity

Prices and volumes are retained as decimal strings from the exchange. This avoids losing exchange precision when a JSON payload is parsed into JavaScript numbers. OHLC consistency checks use scaled integer arithmetic with `BigInt`; consumers must also use decimal-safe arithmetic for monetary calculations and only convert to floating-point numbers at visualization boundaries where appropriate.

The normalizer rejects malformed rows, non-decimal strings, unsafe timestamps and invalid trade counts. The validator rejects empty datasets, non-positive prices, invalid candle timestamps, invalid quantities, impossible OHLC ranges, duplicate timestamps and out-of-order candles.

## Binance Spot source

The adapter calls the fixed public endpoint `GET https://api.binance.com/api/v3/klines`. It sends no API key, signature, account data or order request. Direct calls validate symbol, interval and limit, use an explicit timeout, cap response bodies at 2 MiB by default, and return typed timeout, network, HTTP, rate-limit, oversized-response and JSON errors. It does not silently retry.

## Cache and freshness

The in-memory cache defaults to a 5-second TTL and 100 entries. Cache hits are explicitly marked `freshness: "cached"`; network responses are marked `freshness: "live"`. The timestamp `fetchedAt` records the last exchange fetch, not the time of a cache read. Expired data is not returned as live and is not used as a silent fallback when the provider fails.

Cache entries and the per-user limiter are process-local, are lost on restart, and are not shared across server instances.

## Limitations and safety

- Public market-data access is subject to Binance availability, geographic restrictions and rate limits.
- The latest returned candle may still be forming. Consumers must inspect its close time and current time before treating it as final.
- The UI panel currently displays only BTC/USDT Spot, with a 96-candle 15-minute window and 30-second polling. Historical backfill, WebSocket streaming, news, additional exchanges and integration into the existing demo chart are not included.
- No account connection, AI-generated trade signal, paper order or live order is implemented here.
- Provider data is market information, not an investment recommendation or guaranteed forecast.
- The read-only endpoint does not make the existing offline APK online and does not authorize deployment or publication.

## Verification

Unit tests cover exact decimal normalization, OHLC validation, provider-independent service behavior, cache TTL/defensive copies/eviction, Binance request shape, HTTP rate limits, malformed JSON, response-size limits, timeouts, request-schema validation, per-user throttling, authentication and tRPC error mapping.

Run the repository checks from the project root:

```bash
pnpm check
pnpm test
pnpm build
```

GitHub Actions is configured for Node.js 22 and 24. These checks must complete successfully before the pull request can be considered verified; local source compilation and targeted smoke checks do not substitute for the complete suite and CI.
