# Backtesting Engine

## Scope
The modular backtesting engine evaluates deterministic EMA Crossover and RSI Mean Reversion strategies on stored, closed Binance Spot historical candles. Both use the same deterministic execution core and are separate from synthetic Monte Carlo scenario simulation.

## Execution model
- EMA crossover and RSI threshold-crossing events are computed from a completed candle.
- RSI Mean Reversion enters LONG when RSI crosses upward through the oversold threshold and SHORT when it crosses downward through the overbought threshold. Direction-specific exit events close only the matching side.
- Entries and opposite-signal exits are filled at the following candle open, with configured adverse slippage.
- Stop-loss and take-profit are evaluated against each candle's high/low after entry.
- If both levels are touched within one candle, stop-loss is assumed first because OHLC data does not reveal the intrabar path.
- Gaps in the historical series reject the run rather than allowing indicators to bridge missing data.
- Strategy-specific warm-up candles do not create trades.
- The selected strategy ID and its full parameter configuration are included in the reproducible run identity.

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
- The public backtest and Walk-Forward workflows support EMA Crossover and RSI Mean Reversion. Strategy Robustness remains explicitly EMA-only because its neighboring-parameter sensitivity analysis is EMA-specific. Strategy benchmark comparisons reuse the selected strategy against Buy & Hold 1x, risk-matched Buy & Hold and cash controls.
