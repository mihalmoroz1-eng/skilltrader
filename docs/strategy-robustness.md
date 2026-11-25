# Strategy Robustness Engine

## Purpose
The engine evaluates whether the existing EMA crossover backtest is sensitive to reasonable changes in execution costs and nearby EMA periods, and describes the market regimes in which its baseline trades were opened. It is a diagnostic, not a strategy optimizer.

## Cost stress
- Runs the same data and strategy with baseline, 1.5x and 2x fee and adverse-slippage assumptions.
- Base fee and slippage inputs are capped at 50 bps each so the 2x case remains within the backtest engine's 100 bps bound.
- Cost scenarios are independent backtests with identical starting capital and fixed strategy parameters.

## Parameter sensitivity
- Runs a fixed, bounded set of up to eight neighboring fast/slow EMA combinations around the supplied baseline.
- Invalid combinations are omitted; no parameter grid search, ranking, best-candidate selection or automatic configuration change is performed.
- All neighboring variants use the same stored candle series and the same costs, risk, stop and target assumptions.

## Market regime attribution
- Each baseline trade is assigned to a regime using exactly lookback + 1 candles that are closed strictly before its entry candle. The entry candle and all later candles are excluded.
- Uses the canonical five-regime classifier shared with Market Regime Intelligence: uptrend, downtrend, ranging, high volatility and transition. Classification uses net close-to-close movement, path efficiency and average true range.
- Both modules use matching defaults: 30-candle lookback, 100 bps trend threshold, 50 bps range threshold and 200 bps high-volatility threshold. Inputs are explicit and are not calibrated from the full sample.
- The regime table is attribution of baseline trades by their entry regime. It is not a separate simulated portfolio for each regime.
- Trades without enough prior history are placed in a separate bucket and excluded from regime coverage.
- Regime groups with fewer than five trades are marked `insufficient_sample`; this is a display threshold, not a claim of statistical significance.

## Limits and safety
- Reads stored historical candles only; no direct exchange fetch is performed by this module.
- Historical input is contiguous and limited to 50,000 candles.
- All scenarios reuse the existing backtest fill rules, stop-first OHLC handling, fee/slippage accounting and 1x notional cap.
- Results are reproducible and include a SHA-256 candle digest and `executionEligible=false`.
- No signals, PAPER orders, exchange orders or LIVE execution are created or authorized.


The classifier is implemented in `server/market-regime/core/MarketRegimeClassifier.ts` and is shared with the Market Regime Intelligence rolling analysis. Regime attribution remains descriptive by entry regime; it is not a regime-conditioned strategy simulation.
