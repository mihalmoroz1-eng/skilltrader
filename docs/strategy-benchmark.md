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
