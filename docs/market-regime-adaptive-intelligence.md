# Market Regime Adaptive Intelligence

## Status
Design and architecture audit. This document defines the next research-only stage; it does not authorize strategy switching, signal generation, PAPER mutation, or exchange execution.

## Goal
Make historical strategy evaluation use the same deterministic market-regime vocabulary as Market Regime Intelligence. Report how the existing strategy behaved in each regime and surface evidence limitations without selecting or changing a strategy.

## Audit findings

1. **Two incompatible regime taxonomies exist.**
   - `MarketRegimeEngine` emits `uptrend`, `downtrend`, `ranging`, `high_volatility`, and `transition`.
   - `StrategyRobustnessEngine` independently emits bullish/bearish/range crossed with low/high volatility, plus `insufficient_history`.
   - The two modules use different calculations and thresholds (ATR + path efficiency versus close momentum + standard deviation). Their outputs cannot be compared as if they describe the same state.

2. **Current robustness regime output is entry attribution, not a regime-specific backtest.**
   - Each baseline trade is grouped by the regime immediately before its entry candle.
   - Trade PnL is then attributed to that entry regime even if the trade exits in a different regime.
   - This is useful descriptive attribution, but it is not an independent simulation of strategy performance while a regime is active.

3. **Look-ahead protection is partly present and must be preserved.**
   - Current attribution uses the last completed candle before the entry candle.
   - The canonical classifier must receive only candles with `closeTime < entryTime`; the entry candle and all later candles are excluded from classification.

4. **Numerical validation should be consistent.**
   - The market-regime engine rejects non-finite intermediate calculations.
   - The existing robustness classifier does not explicitly reject overflow in momentum / volatility calculations. The shared classifier must fail closed instead of assigning a regime from non-finite values.

## Proposed architecture

### 1. Canonical classifier
Implemented as `server/market-regime/core/MarketRegimeClassifier.ts`, a reusable server-side pure module.

Inputs:
- A contiguous sequence of closed `MarketCandle` records.
- The same lookback and basis-point thresholds used by Market Regime Intelligence.

Outputs:
- One of the canonical five regime IDs.
- Rule-strength score (explicitly not a probability).
- Net change, path efficiency and average true range in basis points.

Rules:
- Keep high-volatility precedence, trend efficiency threshold (0.35), range efficiency ceiling (0.25), and current threshold semantics.
- Require exactly `lookback + 1` candles for one classification.
- Validate finite positive OHLC, OHLC relationships, exact interval boundaries and consecutive timestamps.
- Reject non-finite intermediate arithmetic.
- Never interpolate, synthesize, or silently skip missing candles.

### 2. Reuse in Market Regime Intelligence
Implemented: `MarketRegimeEngine` calls the canonical classifier for every eligible rolling window. Existing response shape and five regime labels are retained.

### 3. Reuse in Strategy Robustness
Implemented: Strategy Robustness now uses the canonical five regimes plus `insufficient_history`; its former six trend/volatility combinations were removed.

For each baseline trade:
- Find its entry candle by exact `entryTime`.
- Select only the immediately preceding `lookback + 1` completed candles.
- Classify that trailing window.
- Attribute the completed trade result to the regime at entry, and label this explicitly as entry-regime attribution.

Implemented: both endpoints use lookback 30, trend threshold 100 bps, range threshold 50 bps and high-volatility threshold 200 bps by default. The robustness request schema and UI expose the same settings and reject a range threshold greater than or equal to the trend threshold.

### 4. Regime performance diagnostics
Implemented per regime:
- Trade count, winners, losers, net PnL, average trade PnL, win rate and profit factor.
- Sample status: `insufficient_sample` below five trades and `adequate_sample` at five or more. This is a display-quality threshold, not statistical significance; empty and low-count groups must not be interpreted as zero-performance evidence.
- Coverage: attributed trades / all baseline trades.
- Latest regime and recent regime transitions from the same canonical classifier, where the selected historical range supports them.

Do not rank regimes as recommendations. Do not claim a strategy is suitable or unsuitable based on small samples.

### 5. Optional future phase: regime-conditioned simulation
A separate, later phase may calculate returns during regime intervals or run isolated per-regime simulations. It must define entry/exit treatment at regime boundaries, open positions crossing boundaries, fees, slippage, and non-overlapping samples before implementation. Entry-regime attribution must not be presented as that simulation.

## API and UI integration
- Keep protected authenticated endpoints and the existing per-user rate limiter.
- Prefer extending the existing Strategy Robustness response and panel rather than adding a duplicate endpoint.
- Implemented in `StrategyRobustnessPanel`: canonical regime labels, sample counts, sample status, and entry-regime attribution wording.
- Mark small-sample groups unavailable, not zero.
- Use only stored, closed historical candles; do not trigger new exchange downloads from the analysis.
- Include data digest and deterministic run ID in the result.

## Safety invariants
- Research-only and read-only.
- `executionEligible=false`; `exchangeOrderSent=false` where represented.
- No automatic strategy switching, parameter tuning, signal creation, PAPER position changes, risk-limit changes, LIVE execution, or exchange orders.
- Deterministic Account Risk Engine remains the sole authority for PAPER eligibility and sizing.
- AI agents cannot override regime classifications or execution controls.

## Acceptance criteria
1. Implemented parity test: standalone classifier and rolling Market Regime Intelligence return identical labels and metrics for the same window.
2. Implemented trade-attribution test independently reconstructs each entry label from exactly the preceding `lookback + 1` candles and asserts the final candle closed before entry.
3. Gaps, duplicates, malformed candles, invalid thresholds and non-finite arithmetic fail closed.
4. All baseline trades are either assigned to one canonical regime or explicitly marked `insufficient_history`.
5. Tests verify all six output buckets and sample-status thresholds; coverage remains attributed trades divided by baseline trades.
6. Existing backtest baseline metrics remain unchanged.
7. Existing strategy robustness cost and EMA-neighbor scenarios remain unchanged.
8. UI explains entry-regime attribution and does not present it as a separate regime-specific backtest.
9. Node 22 and Node 24 type checks, tests and production builds pass.
10. Changes remain on `feature/market-data-intelligence`; `main` is not merged or modified without explicit approval.


## Implementation notes (2026-11-25)

- Added the canonical classifier and reused it from both engines.
- Replaced robustness request fields with canonical range and high-volatility thresholds; defaults now match Market Regime Intelligence.
- Updated the Strategy Robustness UI to show five canonical market regimes and an explicit sample-status column.
- Added parity, interval-boundary, request-validation, and pre-entry-only attribution tests.
- The `insufficient_sample` threshold is five trades and is not a statistical confidence claim.
