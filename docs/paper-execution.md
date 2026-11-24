# PAPER Execution Engine

## Purpose
PAPER is an isolated virtual trading ledger. It does not connect to private exchange account endpoints and never sends an order to Binance. The mode is permanently labeled PAPER in this initial implementation; no LIVE execution route is included.

## Account setup
The user must explicitly initialize a virtual account and provide starting USDT balance and risk settings. No personal balance or exchange account data is inferred. Starting virtual capital is capped at 1,000,000,000 USDT.

Risk settings include per-trade risk, daily loss cap, maximum gross exposure, maximum open positions, fee and slippage assumptions. Gross exposure is capped at 1x equity; leverage is not supported.

## Signal approval lifecycle
1. The server runs Market Intelligence and Signal Validation.
2. Only a reviewable server-generated candidate is persisted to paper_signal_reviews as pending.
3. The authenticated user must explicitly accept or dismiss the pending signal.
4. Signal approvals expire after five minutes. A signal can open at most one PAPER position. Opening consumes the accepted signal inside a database transaction.
5. PAPER opening requires user-supplied stop and target prices. Entry reference price comes from the public USD-M Futures mark price; the engine applies adverse slippage and rounds simulated fills to the public instrument tick size.

The API never accepts a client-created candidate as proof of validation. It looks up the server-persisted signal record scoped to the authenticated user.

## Risk checks and ledger
Before opening, the Account Risk Engine calculates quantity using fixed-point arithmetic and checks snapshot freshness, position count, daily loss budget, per-trade risk, gross exposure and instrument minimum quantity. Instrument tick and quantity rules are read from public Binance USD-M exchange information.

The account snapshot includes current open notional and mark-to-market unrealized PnL. Adverse unrealized losses consume daily risk budget; profitable unrealized PnL does not offset accumulated daily losses. Daily loss accounting resets on UTC date change.

The database transaction locks the PAPER account, accepted signal and open positions, verifies that the state used for risk calculation has not changed, then updates the account, consumes the signal, inserts the virtual position and appends an audit event. Concurrent state changes fail closed and require a fresh calculation.

## Position management
- paper.close closes a virtual position at the latest public mark price with adverse slippage and exit fees.
- paper.sync checks open positions against stop and target using the latest mark price and closes virtual positions when a threshold is crossed.
- Sync is user-triggered in this version; there is no background monitor or guaranteed stop execution. If sync is delayed, the simulated close uses the current mark price, not a guaranteed stop price.
- Unrealized PnL is estimated from mark price and fee/slippage assumptions; it is not a fill guarantee.

## Persistence
Migration 0002_paper_execution.sql creates:
- paper_accounts — one virtual account per authenticated user;
- paper_signal_reviews — server-generated signal review lifecycle;
- paper_positions — virtual open/closed positions;
- paper_events — append-only operational events.

All balances, prices, quantities and PnL values are persisted as decimal strings. No exchange API keys are stored.

## Safety boundaries and limitations
- Every result has executionEligible=false; every response reports exchangeOrderSent=false.
- No real orders, private account queries, withdrawals, leverage, liquidation or funding payments.
- No automatic position sizing by AI; only the deterministic Account Risk Engine sizes.
- Initial position management uses public mark price, not trade-by-trade or synchronized depth execution.
- Stop/target checks require an explicit PAPER sync call; no background service is enabled.
- The initial contract multiplier is 1 for linear USDT-M perpetuals. Other contract types are rejected by the instrument rules provider.
