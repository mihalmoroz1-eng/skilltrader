# Account Risk Engine

## Purpose
A deterministic TypeScript module evaluates a proposed PAPER-review candidate against a timestamped account snapshot and explicit risk limits. AI agents cannot calculate position size, change limits or override the result.

## Inputs
- Account equity, realized daily loss, current gross open notional and open-position count.
- Maximum open positions.
- Per-trade risk, daily loss and gross exposure limits in basis points.
- Account snapshot timestamp.
- Candidate direction, entry and stop reference prices.
- Contract multiplier, quantity step and minimum quantity.
- Combined round-trip fee/slippage estimate in basis points.

Monetary and quantity inputs are decimal strings with up to eight decimal places. Calculations use fixed-point BigInt arithmetic.

## Checks
1. Account snapshot freshness (maximum 30 seconds).
2. Open-position count.
3. Remaining daily loss budget.
4. Per-trade estimated loss, including configured round-trip costs.
5. Remaining gross exposure.
6. Minimum instrument quantity.

Quantity is rounded down to the instrument step. Any failed check rejects the result and suppresses proposed sizing.

## Safety boundary
- approved_for_paper_review is not a trade recommendation or order authorization.
- executionEligible is always false.
- No exchange account API, balance retrieval, risk-profile persistence or order submission is connected.
- A future authenticated account-snapshot provider and durable risk-profile storage are required before live-account use.
- Leverage, liquidation price, funding, borrow costs, portfolio correlation, options greeks and exchange-specific contract rules are not modeled. Unsupported instruments must not be treated as fully risk-checked.
- Gaps, slippage beyond estimates, outages and execution behavior can increase realized loss.

## Verification
Unit tests cover fixed-point sizing, stale account data, daily loss exhaustion, position limits, stop direction, SHORT candidates, exposure limits and malformed inputs.
