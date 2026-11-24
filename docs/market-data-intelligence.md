# Market Data Intelligence

## Scope

This module is a server-side, read-only market-data foundation. The first adapter uses Binance Spot public REST klines. It requires no API key, account permission, or trading credential and has no order-placement capability.

The existing dashboard and simulation remain synthetic. This module is not connected to the UI, scenario engine, signal pipeline, or execution path.

## Data flow

`MarketDataService` validates the request, checks the bounded TTL cache, calls a provider adapter, validates canonical candles, and returns a snapshot with source and freshness metadata.

- Provider contract: `core/MarketDataTypes.ts`
- Binance adapter and HTTP boundary: `providers/BinanceSpotProvider.ts`
- Binance payload normalizer: `core/MarketDataNormalizer.ts`
- Canonical data validator: `core/MarketDataValidator.ts`
- TTL cache: `core/MarketDataCache.ts`
- Provider-independent orchestration: `services/MarketDataService.ts`

A future data source implements `MarketDataProvider` and returns canonical `MarketCandle[]`; it does not need to expose its wire format to the service.

## Precision and data integrity

Prices and volumes are retained as decimal strings from the exchange. This avoids losing exchange precision when the JSON payload is parsed into JavaScript numbers. OHLC consistency checks use scaled integer arithmetic with `BigInt`; consumers must also use decimal-safe arithmetic for monetary calculations and only convert to floating-point numbers at visualization boundaries where appropriate.

The normalizer rejects malformed rows, non-decimal strings, unsafe timestamps and invalid trade counts. The validator rejects empty datasets, non-positive prices, invalid candle timestamps, negative/non-decimal quantities, impossible OHLC ranges, duplicate timestamps and out-of-order candles.

## Binance Spot source

The adapter calls the fixed public endpoint `GET https://api.binance.com/api/v3/klines`. It sends no API key, signature, account data or order request. Direct calls validate symbol, interval and limit, use an explicit timeout, cap response bodies at 2 MiB by default, and return typed timeout, network, HTTP, rate-limit, oversized-response and JSON errors. It does not silently retry.

The service accepts limits from 1 to 1,000 candles. Symbols are normalized to uppercase before a provider is called.

## Cache and freshness

The in-memory cache defaults to a 5-second TTL and 100 entries. Cache hits are explicitly marked `freshness: "cached"`; network responses are marked `freshness: "live"`. The timestamp `fetchedAt` records the last exchange fetch, not the time of a cache read. Expired data is not returned as live and is not used as a silent fallback when the provider fails.

Cache entries are process-local, are lost on restart, and are not shared across server instances.

## Limitations and safety

- Public market-data access is subject to Binance availability, geographic restrictions and rate limits.
- The latest returned candle may still be forming. Consumers must inspect its close time and current time before treating it as final.
- Historical backfill, WebSocket streaming, news, additional exchanges, tRPC exposure and UI integration are not included.
- No account connection, AI-generated trade signal, paper order or live order is implemented here.
- Provider data is market information, not an investment recommendation or guaranteed forecast.

## Verification

Unit tests cover exact decimal normalization, OHLC validation, provider independence, cache TTL/defensive copies/eviction, Binance request shape, HTTP rate limits, malformed JSON, oversized payloads and invalid inputs.

Run the repository checks from the project root:

```bash
pnpm check
pnpm test
pnpm build
```

GitHub Actions is configured for Node.js 22 and 24. These checks must complete successfully before the pull request can be considered verified; creating source files or tests alone is not evidence of a passing run.
