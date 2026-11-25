# Market Regime Intelligence

## Purpose
A deterministic, read-only historical classifier for uptrend, downtrend, ranging, high-volatility and transition regimes. It reads already-ingested, closed historical candles and does not fetch or synthesize missing history.

## Method
For each completed rolling window it calculates:
- Net close-to-close movement in basis points.
- Path efficiency: absolute net movement divided by the sum of absolute close-to-close moves.
- Average true range as basis points of the preceding close.

High volatility takes precedence. Directional trend requires the configured net-move threshold and efficiency >= 0.35. Ranging requires net movement inside the range threshold and efficiency <= 0.25. Remaining windows are transition. Defaults: 30 candles, 100 bps trend threshold, 50 bps range threshold and 200 bps average true-range threshold.

Confidence is a bounded deterministic rule-strength score, not a probability. Output includes rolling history, regime distribution and up to 100 most recent transitions. Exact candle continuity is mandatory; gaps, duplicates, invalid OHLC and insufficient history fail closed.

## Safety
Research-only. No signals, forecast, trade direction recommendation, PAPER mutation, risk-limit changes or exchange order submission. Every response reports `executionEligible=false` and `exchangeOrderSent=false`. Android offline demo remains disconnected from server history.
