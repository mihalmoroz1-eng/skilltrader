# Research Agent

## Scope
Initial Research Agent combines deterministic Binance Spot market facts with the public USD-M Futures liquidity/funding snapshot. It produces a bounded qualitative assessment from a server-derived evidence allow-list.

## Inputs
- Spot: approved source, freshness, data quality, latest closed candle, EMA20/EMA50, RSI14, MACD histogram and ATR-to-close ratio.
- Futures: source/freshness, spread, depth imbalance, funding rate, mark/index basis and open interest.
- Spot and Futures symbols must match. Both sources must be no older than 30 seconds; Spot history must be ready, gap-free and contain at least 50 closed candles.

## Output
- Assessment: constructive, mixed, cautionary or insufficient.
- Evidence codes selected only from the server-generated allow-list.
- Risk flags selected only from server-generated risk flags.
- Source timestamps, model identifier, SHA-256 evidence digest and research digest.
- executionEligible is always false.

## Boundaries
This first version is structured market-context research, not external news research. It does not connect news feeds, macro calendars, on-chain sources or third-party research publications. The model receives no tools and cannot browse, call external services, create signals, calculate position size or execute orders. The current model is the same configured model used elsewhere in the app; separate prompts do not constitute cross-provider verification.
