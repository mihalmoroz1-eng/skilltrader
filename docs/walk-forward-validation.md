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

## Limits and safety
- Only stored historical Binance Spot candles are read; the engine does not fetch data directly.
- Each run is limited to 50,000 candles, 2–12 validation folds, 10–10,000 candles per validation segment and 30,000 training candles per fold.
- The existing backtesting execution rules, fees, adverse slippage, conservative stop-first OHLC handling and 1x notional cap are reused.
- Results are research-only and always include `executionEligible=false`.
- No signals, PAPER orders, exchange orders or LIVE execution are created or authorized.
