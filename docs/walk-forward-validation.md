# Walk-Forward Validation Engine

## Purpose
The engine evaluates the selected deterministic EMA Crossover, RSI Mean Reversion, MACD Momentum or Breakout strategy across sequential rolling training and out-of-sample validation windows. The strategy and its parameters remain fixed across all folds. It is a robustness diagnostic, not a strategy optimizer.

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
- The strategy configuration is fixed across folds. EMA uses its slow-period warm-up; RSI uses its RSI-period warm-up; MACD uses its slow EMA and signal-line warm-up; Breakout uses its prior-range lookback plus next-open boundary. This workflow does not optimize strategy or risk parameters on the training data.

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
- The shared backtesting execution rules for the selected strategy, fees, adverse slippage, direction-specific strategy exits, conservative stop-first OHLC handling and 1x notional cap are reused.
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
- The training window must cover the selected strategy's warm-up (including the MACD signal-line period when MACD Momentum is selected, or the Breakout lookback plus next-open boundary when Breakout is selected) and the configured regime lookback. Defaults: 30-candle lookback, 100 bps trend threshold, 50 bps range threshold and 200 bps high-volatility threshold.
- The classifier is deterministic and shared with Market Regime Intelligence. It uses completed OHLC candles only.
- Research-only: no parameter optimization, regime-based strategy selection, automatic switching, signals, PAPER mutation, risk-limit change or exchange order is performed. `executionEligible=false`.


## Cross-fold Regime Stability Aggregator

The result includes a separate regime stability summary across the independent OOS folds.

- A regime is counted as observed in a fold only when that fold has at least one interval assigned to the regime. Coverage is reported as observed folds / total folds.
- Each fold contributes its own conditional compounded return as one fold-level observation. The aggregator reports the mean, median, worst, best and population dispersion across those fold-level values; it does not concatenate interval returns or equity curves and does not calculate a synthetic combined return.
- Positive-fold share is calculated only from finite, available fold returns and is withheld unless at least two folds contribute.
- Per-regime sample adequacy is reported as counts of insufficient (<5), limited (5–29) and adequate (>=30) fold samples. These are descriptive coverage labels, not significance tests.
- Volatility, Sharpe and Sortino summaries include only finite fold-level values already made available by the per-regime analytics. Descriptive aggregates require at least two contributing folds; unavailable values are never treated as zero.
- A regime can have high fold coverage but weak within-fold sample adequacy. Both dimensions are shown separately.
- The aggregator is descriptive and does not rank or select strategies, tune parameters, switch regimes, generate signals, mutate PAPER positions or authorize orders. It does not change execution eligibility.


## Regime Stability Scoring

Each cross-fold regime summary now includes a versioned heuristic Stability Score (0–100), component breakdown, rating and evidence tier.

- Four equally weighted components (25% each): observed-fold coverage, adequate-sample share, positive-return fold consistency and dispersion control.
- Coverage is observed folds divided by all requested folds. Sample adequacy is the share of observed folds with at least 30 regime observations.
- Positive-return consistency is the share of finite fold-local conditional returns greater than zero. It is unavailable unless at least two finite fold returns exist.
- Dispersion control is `100 / (1 + σ / (|median fold return| + 5 percentage points))`, where σ is the population standard deviation across independent fold-local conditional returns. The 5 percentage-point floor avoids division by a near-zero median and is a fixed heuristic scale, not a calibrated risk threshold.
- The total score is withheld unless at least three folds observed the regime and at least two finite fold returns are available. Missing components are not replaced with zero.
- Ratings are descriptive score bands: high (>=80), moderate (>=60 and <80), low (<60). Evidence tiers depend on observed folds: insufficient (<3), limited (3–4), moderate (5–7), strong (>=8).
- Score, rating and evidence tier are not probabilities, statistical significance tests, forecasts or recommendations. Scores are not comparable across different validation horizons or materially different scoring configurations without considering their methodology.
- Scoring version is exposed as `1.0` so later methodology changes can be distinguished.
- The score does not rank or select strategies, switch strategies by regime, tune parameters, generate signals, change risk limits, mutate PAPER positions or authorize exchange orders.


## Regime Adaptive Intelligence

Each independent out-of-sample fold now includes a regime-conditioned comparison between the EMA strategy's marked-to-market equity returns and a gross underlying-asset price-return reference.

- Each OOS interval is assigned to the canonical regime known at the previous candle close. The first OOS interval uses the final completed training candle for classification; no current-interval close is used to classify its own return.
- The strategy return is derived from the fold's own marked-to-market validation equity curve, which includes the strategy's configured fees, slippage and existing backtest execution assumptions.
- The reference is the underlying asset's gross Buy & Hold price return: first OOS interval open-to-close, then close-to-close. It excludes fees, spread, slippage, financing and execution constraints and is not exposure-matched to the strategy. It is therefore a directional context reference, not a like-for-like benchmark or an investable performance comparison.
- Per regime and per fold, the result retains observation count, sample adequacy, conditional strategy return, gross asset return, excess return in percentage points and whether strategy return exceeded the reference.
- Cross-fold summaries report observed-fold coverage, median fold-local strategy return, median gross asset return, median and worst excess return, and positive-excess fold share. At least two finite folds are required for medians and positive-fold share. Independent fold results are retained; interval returns and equity curves are never concatenated or pooled.
- Sample labels are descriptive: insufficient (<5), limited (5–29), adequate (>=30). These thresholds are not significance tests. Missing or non-finite metrics remain unavailable.
- The analysis is limited to the fixed EMA crossover strategy already evaluated by Walk-Forward. It does not select among strategies, optimize parameters, switch strategies, create signals, alter risk limits, mutate PAPER positions or submit exchange orders. Results remain research-only and executionEligible=false.
