# Signal Validation Engine

## Purpose

The Signal Validation Engine turns a completed AI Market Intelligence run into a constrained directional candidate for human review. It is deterministic TypeScript code. It does not call an LLM, calculate an entry/stop/target, size a position, place an order or change the synthetic demo scenario.

The only candidate directions in this stage are `LONG` and `SHORT`. They describe a technical hypothesis supported by the selected evidence and are not recommendations or an instruction to trade.

## Pipeline

```text
Binance Spot read-only candles
  -> deterministic normalization and indicators
  -> AI Market / Strategy / Risk / Critic
  -> Market Intelligence result with server-derived evidence
  -> Signal Validation Engine
       1. source, freshness, timestamps and market-data quality
       2. Critic consensus
       3. server evidence allow-list integrity
       4. market/strategy directional alignment
       5. deterministic technical-risk gate
       6. account-level Risk Engine availability
  -> reviewable / rejected / inconclusive / no_candidate
  -> human review event in browser-local journal
```

The existing protected `marketIntelligence.analyze` route now returns a `signalValidation` result after the server has completed AI analysis. The validator receives the result directly in the same server request; it does not accept a client-supplied analysis payload as validation authority.

## Candidate rules

A LONG candidate is produced only if all of the following are true:
- Market Agent regime is `uptrend` and momentum is `positive`;
- Strategy Context is `trend_context`;
- server evidence includes `close_above_ema20`, `ema20_above_ema50`, `macd_histogram_positive` and `trend_structure_up`;
- the Market Agent lists the same directional evidence;
- Strategy Context includes `ema20_above_ema50` and `trend_structure_up`.

SHORT is the symmetric case using below-EMA, negative MACD and downtrend evidence.

No directional candidate is forced for a range, mixed, mean-reversion or unclear context. Such runs return `no_candidate` (provided the upstream data and validation checks are otherwise sound).

## Deterministic checks

### Market-data integrity

The validator rechecks:
- approved source `binance-spot`;
- supported symbol and interval;
- `live` or `cached` freshness with a fetch timestamp no more than 30 seconds old at validation time;
- a valid fetch/processing timestamp order and a closed-candle close timestamp;
- the latest closed candle is not more than two requested intervals old;
- quality status `ready`, at least 50 closed candles and zero gaps.

A candidate that becomes stale while the four AI calls are running is rejected at validation time.

### Agent consensus and evidence

The result must be marked `reviewable`, Critic must return `consistent`, and it must have no conflict codes.

Market and Strategy evidence codes must be members of the server-derived market evidence set. Risk Agent codes and the technical risk gate's codes must exactly match the server-derived risk evidence set. Invented or omitted evidence is rejected.

### Deterministic technical-risk gate

This is a conservative technical filter over server-calculated indicators, not the complete account-level Risk Engine.

The following server-derived codes block a directional candidate:
- `atr_ratio_above_2_percent`;
- `rsi_extreme`;
- `price_extension_from_ema20` (absolute deviation of at least 1.5%);
- `indicator_disagreement`.

The ATR percentage is cross-checked against the matching server-derived ATR band. Risk Agent must also classify the context as `normal`. If the AI risk label conflicts with server evidence, the candidate is rejected.

These fixed filters are heuristics. They are not calibrated risk limits, a user's financial risk profile, a maximum loss calculation, stop distance, contract-aware notional exposure or position-size instruction.

### Account Risk Engine

The repository's existing `RiskPanel` is a client-side calculation for the synthetic demo scenario. It is not an account-level backend engine for live-market candidates. Therefore the validation result always records:

- `account_risk_engine = not_connected`;
- `requiresSeparateAccountRiskEngine = true`;
- `executionEligible = false`;
- `manualReviewOnly = true`.

A status of `reviewable` means only that the technical hypothesis may be inspected by a human. It does not mean the account-level risk is approved or that the candidate is ready for execution. A later stage must implement and connect a server-side deterministic Risk Engine with approved account inputs, instrument contract specifications, costs and explicit risk limits before any execution path can be considered.

## Validation statuses

- `reviewable`: candidate passes the current data, evidence, consensus and technical-risk filters; human analytical review only.
- `rejected`: data integrity, evidence integrity or technical-risk check failed.
- `inconclusive`: Critic did not confirm a consistent result.
- `no_candidate`: no supported trend-following direction was found.

Every result includes six named checks, reason codes, warnings, source run ID, upstream evidence digest, validation timestamp and a SHA-256 digest of the validation payload.

## Human review and journal

The UI offers two manual decisions for a `reviewable` candidate:
- accept it for further review;
- dismiss the candidate.

Neither action submits an order or grants execution approval.

Review events are stored in browser `localStorage` under `skilltrader.signal-audit.v1`, with a limit of 500 retained events. Events capture signal ID, market run ID, validation digest, event type and timestamp. Duplicate event types for the same signal are not appended twice.

This is a device-local convenience journal only. Browser storage can be cleared or altered by the user, is not shared across devices, is not a durable server audit log, and is not tamper-proof. Database-backed append-only audit retention and external integrity anchoring are not implemented. If browser storage is unavailable, the UI reports the failure and does not claim that the event was recorded.

## Out of scope

- Account balance and user-specific risk calculations.
- Position sizing, leverage, margin or contract-specific quantity.
- Entry, stop-loss, take-profit and order parameters.
- Signal expiry/market revalidation after the displayed review result.
- Paper or live execution.
- Server-side durable audit storage.
- Independent cross-provider model review.

No signal is executed by this stage. PAPER execution and LIVE execution remain separate future stages, with LIVE requiring separate explicit user approval.


## Boundary between AI analysis and signal validation

The Market Intelligence result still carries `noTradeSignalGenerated: true` and `noOrderExecuted: true`: specialist agents and the Critic do not emit executable trade signals. The protected route then passes this completed analysis to the separate deterministic Signal Validation Engine. That validator may produce a directional candidate for manual review, or reject/withhold it. The candidate is not an agent-generated signal and is never an order. The UI labels these as two distinct stages.
