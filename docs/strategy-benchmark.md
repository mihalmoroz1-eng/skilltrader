# Strategy Benchmark & Comparative Analytics Engine

## Purpose
The engine compares the deterministic EMA Crossover strategy with three controls on exactly the same validated, contiguous, closed historical candle series and active evaluation period:
- Buy & Hold 1x: invests 100% of starting notional at the first eligible candle open.
- Buy & Hold risk-matched: uses a fixed initial exposure fraction equal to min(1, riskBps / stopLossBps), then holds through the final candle close.
- Cash control: keeps all starting capital uninvested.

## Comparable assumptions
- All tracks use the same starting capital and the same base fee and adverse-slippage assumptions.
- The Buy & Hold tracks apply adverse slippage at entry and exit and fees on both sides.
- The active evaluation begins at the first candle where the EMA engine may evaluate a completed-candle signal; warm-up history is common to all tracks.
- Buy & Hold does not use EMA signals, stop-loss, take-profit or reversal exits.
- Cash control has no exposure, trades, fees or market PnL.

## Metrics
Reports final equity, net PnL, total return, marked-to-market maximum drawdown, fees and trade count for every track. Strategy-relative excess returns and drawdown differences are reported in percentage points.

## Exposure interpretation
Buy & Hold 1x is a fully invested passive baseline and therefore has higher initial market exposure than EMA when the configured per-trade risk ratio is below 100%. Risk-matched Buy & Hold uses the same initial target-notional ratio as the EMA engine but holds that notional rather than dynamically sizing each trade. It is a fixed-exposure reference, not an exact replication of the EMA strategy's exposure path.

## Limits and safety
- Reads stored historical Binance Spot candles only; no direct market fetch.
- Maximum 50,000 contiguous candles per run.
- Uses the canonical Backtest Engine for the EMA result; no duplicate EMA implementation.
- All Buy & Hold results are deterministic, bound to the same candle SHA-256 digest, and include entry/exit time and execution prices.
- Results are research-only and always include `executionEligible=false`. No signals, PAPER orders, exchange orders or LIVE execution are created or authorized.

## Risk-adjusted strategy efficiency
- EMA Crossover, Buy & Hold 1x and risk-matched Buy & Hold now expose annualized volatility, Sharpe, Sortino and return-to-maximum-drawdown diagnostics.
- Metrics are calculated server-side from timestamped marked-to-market equity curves over the same benchmark evaluation window. The EMA curve includes the initial capital point, candle-close mark-to-market values, fees and final exit costs.
- Sharpe uses a 0% risk-free rate. Sortino uses a 0% target return and downside root-mean-square of negative interval returns. Annualization follows the selected candle interval; monthly candles use 12 periods per year.
- At least 30 interval returns are required for annualized volatility, Sharpe and Sortino. Shorter histories and zero-variance denominators produce unavailable values, not synthetic zeros.
- Return-to-maximum-drawdown is unavailable when maximum drawdown is zero. Cash control has no risk-adjusted ratios because it has no market return observations.
- The equity curve is an internal server calculation input and is not added to the ordinary backtest API response, avoiding an unnecessary large payload.
- This compares the canonical EMA strategy with its existing same-symbol benchmark controls. It does not imply cross-asset or cross-strategy comparability when symbols, periods, capital, fees or execution assumptions differ.
- Research only: no strategy is selected, parameters optimized, signals created, risk limits changed or orders authorized.
