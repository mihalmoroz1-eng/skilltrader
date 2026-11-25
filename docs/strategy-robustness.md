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

## Regime Performance Analytics

The robustness response also includes a separate, read-only analysis of marked-to-market strategy equity across the canonical five regimes.

- Each close-to-close equity return is assigned to the regime classified from the current candle's completed OHLC data. This is retrospective after-close attribution; it is not a prediction or a signal.
- The analysis starts at the existing backtest evaluation boundary and uses the same contiguous closed candles and deterministic equity curve. It does not fetch or synthesize data.
- Per regime it reports interval count, baseline trades attributed at entry, grouped compounded interval return, annualized volatility, Sharpe, Sortino, maximum drawdown within any uninterrupted episode, and episode count.
- Grouped compounded return combines only the observed intervals assigned to that regime. Because these intervals may be non-contiguous, it is a conditional descriptive statistic, not a continuous standalone equity curve or a realizable standalone strategy return.
- Maximum drawdown is computed independently inside each uninterrupted episode of a regime. Episodes are never concatenated to create a synthetic drawdown path.
- Volatility, Sharpe and Sortino require at least 30 interval observations. Annualization adjusts the selected candle frequency by the observed share of intervals assigned to each regime; this is a descriptive frequency approximation. Sample labels are insufficient below five, limited from five through 29, and adequate at 30 or more; these are display thresholds, not statistical significance tests.
- Empty regime buckets return unavailable values, not zero-performance claims.
- Transition diagnostics report observed regime-to-regime changes, transition frequency and the average marked-equity return of intervals where the regime label changed.
- Trade counts remain entry-regime attribution and are not interchangeable with candle-interval observation counts.
- This module does not rank regimes, choose or switch strategies, tune parameters, create signals, mutate PAPER positions, change risk limits or authorize LIVE/exchange orders. `executionEligible=false` remains in force.

Implementation: `server/backtesting/core/RegimePerformanceAnalytics.ts`; dashboard: `StrategyRobustnessPanel`.
