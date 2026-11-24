# Backtesting Engine

## Scope
The first backtesting version evaluates a deterministic EMA crossover strategy on stored, closed Binance Spot historical candles. It is separate from synthetic Monte Carlo scenario simulation.

## Execution model
- EMA signals are computed from a completed candle.
- Entries and opposite-signal exits are filled at the following candle open, with configured adverse slippage.
- Stop-loss and take-profit are evaluated against each candle's high/low after entry.
- If both levels are touched within one candle, stop-loss is assumed first because OHLC data does not reveal the intrabar path.
- Gaps in the historical series reject the run rather than allowing indicators to bridge missing data.
- EMA warm-up candles do not create trades.

## Risk and costs
- Position risk budget and stop distance determine notional size.
- Notional exposure is capped at 1x current equity; leverage is not simulated.
- Fees and slippage are charged on entry and exit.
- A single position is held at a time. Pyramiding and partial fills are not modeled.

## Metrics
The engine reports final equity, net profit, total return, maximum marked-to-market drawdown, win rate, profit factor, average trade return, fees, and per-trade entry/exit data.

## Safety
- The protected tRPC endpoint reads from the historical candle store only.
- Maximum 50,000 candles per run.
- The result includes executionEligible=false. Backtesting is research output, not a signal approval, PAPER order, or LIVE execution.
- Initial strategy is EMA crossover only. Strategy registry, walk-forward validation, parameter search, benchmarks and portfolio-level risk are future stages.
