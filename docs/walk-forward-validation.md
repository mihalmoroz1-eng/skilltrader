# Walk-Forward Validation Engine

## Purpose
The engine evaluates the existing deterministic EMA crossover backtest across sequential rolling training and out-of-sample validation windows. It is a robustness diagnostic, not a strategy optimizer.

## Window model
- Each fold contains a fixed-size training segment followed by a separate validation segment.
- The next fold advances by `stepCandles`; the step must be at least the validation length so out-of-sample windows never overlap.
- The requested data must be contiguous, closed historical candles. Missing intervals reject the entire run, including gaps in candles between validation windows.
- The engine uses the most recent contiguous sequence large enough for the requested fold count, subject to a 50,000-candle maximum.
- Training windows may include earlier validation candles only after those candles have become historical in a later fold.

## Lookahead and account isolation
- Indicators are calculated from each fold's training candles and the validation candles available up to each close.
- The final completed training candle may produce a signal that is filled at the first validation candle open; no validation candle close is used to determine that opening fill.
- Training results and validation results are separate backtests. Validation starts with fresh configured virtual capital and no training position or PnL carried forward.
- Every fold resets starting capital. Aggregate returns are per-window statistics, not a compounded portfolio curve.
- The strategy configuration is fixed across folds. This version does not optimize EMA periods or any risk parameter on the training data.

## Metrics
Reports per-fold in-sample and out-of-sample return, drawdown, trade count and win rate. Aggregate out-of-sample diagnostics include mean and median return, return dispersion, percentage of positive windows, worst validation drawdown, total validation trades, weighted win rate and profit factor based on winning and losing trade PnL.

### Risk-adjusted fold stability
- Each validation fold calculates interval returns from its own timestamped marked-to-market equity curve, including the initial validation boundary and each validation candle close.
- Annualized volatility uses sample standard deviation and interval-specific annualization. Sharpe uses a 0% risk-free rate; Sortino uses a 0% target and downside deviation over all interval observations.
- The annualization convention matches Strategy Benchmark: 1M uses 12 periods/year; fixed intervals use 365.2425 days divided by interval duration.
- At least 30 valid interval returns are required for annualized volatility, Sharpe and Sortino. Invalid/non-positive equity, insufficient observations, zero variance or zero downside deviation leave the affected metric unavailable rather than inventing a ratio.
- Per-fold return-to-maximum-drawdown is unavailable when maximum drawdown is zero.
- Fold aggregates (average, median, worst/minimum and population dispersion) are emitted only when at least two folds have a finite metric. Unavailable folds are excluded, not treated as zero. riskAdjustedFoldCount counts folds with a defined Sharpe ratio.
- Fold equity curves are not exposed or concatenated. Each fold's metrics are computed independently using its own fresh virtual capital; aggregate fold statistics are descriptive and are not a compounded account history.

## Limits and safety
- Only stored historical Binance Spot candles are read; the engine does not fetch data directly.
- Each run is limited to 50,000 candles, 2–12 validation folds, 10–10,000 candles per validation segment and 30,000 training candles per fold.
- The existing backtesting execution rules, fees, adverse slippage, conservative stop-first OHLC handling and 1x notional cap are reused.
- Results are research-only and always include `executionEligible=false`.
- Risk-adjusted metrics are descriptive historical statistics, not forecasts, guarantees, strategy rankings or execution authorization.
- No signals, PAPER orders, exchange orders or LIVE execution are created or authorized.

## Regime Walk-Forward Intelligence

Each independent out-of-sample fold now includes regime-conditional performance diagnostics using the canonical five Market Regime labels.

- The first validation interval is classified using only the final completed training candle and its preceding lookback window.
- Every subsequent validation interval is classified using the regime known at the previous candle close. The current interval's return is never classified using its own closing candle, avoiding same-interval look-ahead.
- Every fold has its own regime counts, conditional compounded interval return, annualized volatility, Sharpe, Sortino, episode-local maximum drawdown, episode count and transition diagnostics.
- Each fold is analyzed independently. No OOS equity curves are stitched, and no fold's regime statistics are pooled into a synthetic cross-fold equity curve.
- Volatility, Sharpe and Sortino require at least 30 observations within a regime. Sample labels are insufficient below five, limited from five through 29, and adequate at 30 or more; these are display thresholds, not statistical significance tests.
- Annualization adjusts by the observed share of intervals assigned to a regime. This is a descriptive frequency approximation; grouped compounded returns are conditional statistics, not standalone realizable strategy returns.
- Drawdown is measured only within uninterrupted episodes of the same regime. Non-contiguous episodes are never concatenated.
- The training window must cover both EMA warm-up and the configured regime lookback. Defaults: 30-candle lookback, 100 bps trend threshold, 50 bps range threshold and 200 bps high-volatility threshold.
- The classifier is deterministic and shared with Market Regime Intelligence. It uses completed OHLC candles only.
- Research-only: no parameter optimization, regime-based strategy selection, automatic switching, signals, PAPER mutation, risk-limit change or exchange order is performed. `executionEligible=false`.
