# Portfolio Intelligence & Correlation Engine

## Scope
This module combines cross-asset historical return correlation with a read-only view of authenticated PAPER positions. It does not create signals, change account settings, approve risk or execute trades.

## Correlation
- Reads stored historical Spot candles only; it does not download or silently fill missing history.
- Uses Pearson correlation of simple close-to-close returns, not price-level correlation.
- Each pair uses exact common candle open times and only consecutive intervals. Missing or misaligned bars are skipped, never interpolated.
- Unclosed candles are excluded. The aligned return sample count is displayed for every pair.
- Correlation is withheld below 30 aligned return observations or when either return series has zero variance.
- Per-symbol closed-candle counts, excluded unclosed candles, first/last timestamps and gap counts are reported.
- Supports 2–10 unique symbols, up to 5,000 candles per symbol and a maximum 366-day query range.

## PAPER portfolio
- Includes open virtual positions only.
- Marked gross notionals use public mark price × quantity × contract multiplier with fixed-point arithmetic.
- Reports gross and net directional exposure, utilization of the configured gross exposure limit, per-symbol weights and a Herfindahl concentration index.
- If a required mark is missing or older than 30 seconds, exposure and stress outputs are withheld. Entry prices are not substituted for missing marks.
- A missing PAPER account does not block historical correlation analysis.

## Stress assumptions and limitations
- Parallel linear price shocks of -5%, -10% and -20% are applied to all open positions. LONG and SHORT PnL signs are handled separately.
- Stressed equity is the current PAPER mark-to-market equity plus estimated shock PnL.
- The model does not simulate liquidation, margin calls, leverage, funding, borrow costs, market impact, exit slippage, shock-driven fees, changing correlations or cross/isolated margin.
- Results are descriptive analytics only. The deterministic Account Risk Engine remains the authority for PAPER eligibility and position sizing.

## Safety
Every result reports executionEligible=false and exchangeOrderSent=false. No private exchange account endpoint or exchange order endpoint is used. The Android demo build remains offline.


## 3D portfolio views
- The asset/correlation map uses only ready Pearson pairs and the exact server-returned symbol exposure.
- The capital concentration view visualizes each open position symbol's share of total gross exposure. It does not represent uninvested cash or total account allocation.
- The largest symbol, largest weight, Herfindahl index, gross exposure and gross-limit utilization are passed through from the deterministic portfolio result without recalculation in the UI.
- Missing or stale marks leave exposure fields unavailable; the visualization displays an empty/unavailable state rather than substituting entry prices or estimated values.
- These views are read-only, do not generate trading signals and do not alter risk controls or PAPER positions.


## Correlation matrix view
- The dashboard matrix is built only from the returned pair records; each ready Pearson value is mirrored across the matrix for readability.
- The diagonal is intentionally omitted, and absent, non-ready or non-finite pairs remain unavailable rather than being estimated.
- Cell color encodes correlation sign and absolute strength; exact coefficient and observation count remain visible in each populated cell.
- The matrix is a presentation layer only and does not calculate portfolio risk, alter the server result or generate signals.


## Portfolio Risk Intelligence diagnostics
- The Portfolio Intelligence server engine calculates and returns a typed `riskIntelligence` object; the dashboard component is a renderer and performs no portfolio-risk arithmetic.
- Only pairs for which both symbols have open PAPER exposure and current validated mark prices are included. Pair coverage is ready pairs divided by all possible held-symbol pairs; missing or non-ready pairs are not treated as zero correlation.
- Weighted absolute correlation uses each pair's product of gross exposure weights. The server returns eligible/total held pairs, coverage, weighted absolute correlation and the signed coefficients of highlighted pairs.
- Pairs with absolute Pearson correlation >= 0.80 are highlighted; >= 0.90 is labelled very high. Positive and negative relationships retain their signed coefficient.
- Overall assessment is withheld unless at least 80% of held-symbol pairs have valid correlation data. Descriptive bands are low (<40%), moderate (40–<70%), and high (>=70%) weighted absolute correlation.
- If mark-to-market data is missing or stale, the existing portfolio engine suppresses symbol exposure and the risk diagnostic returns insufficient data rather than reusing stale holdings.
- The diagnostic does not estimate future correlation, account for individual asset volatility, leverage, liquidation, margin or funding, and does not change positions, limits, approvals, signals or orders. Account Risk Engine remains the sole PAPER eligibility and sizing authority.


## Portfolio Risk Forecast
- The server calculates historical annualized volatility for each held symbol and a portfolio-level volatility estimate from exact common, consecutive close-to-close returns.
- Portfolio returns use signed net exposure weights normalized by current gross exposure, so LONG and SHORT directions are reflected in the historical covariance estimate. All held symbols must have at least 30 valid returns and a sufficient common aligned sample; otherwise the portfolio forecast is withheld.
- The 1-day and 5-day 95% VaR figures use a normal approximation (z = 1.645) and square-root-of-time scaling. VaR is scaled to current gross exposure and displayed relative to current PAPER equity.
- Annualization uses the selected candle interval. Missing symbols, gaps, insufficient samples, zero-variance series, or stale/missing marks do not receive fabricated volatility or VaR values.
- This is a historical statistical risk estimate, not a predictive guarantee, maximum-loss bound, liquidation model, expected shortfall, or trade recommendation. It assumes stable historical distribution and does not model fat tails, volatility clustering, regime shifts, market impact, funding, leverage or fees under a future shock.
- The output is read-only. It does not modify PAPER positions, account limits, signal approval or order execution; `executionEligible=false` and `exchangeOrderSent=false` remain invariant.


## Portfolio Drawdown Intelligence
- The server reconstructs a historical portfolio return path from exact common candle timestamps and consecutive intervals for all currently held symbols. Missing intervals are never interpolated or stitched across gaps.
- Historical portfolio returns use the current PAPER positions' signed net notionals divided by current gross exposure as fixed weights. This is a static-current-exposure approximation, not the account's actual historical NAV or historical position ledger.
- Reports maximum drawdown, current drawdown, duration of the maximum-drawdown episode, current underwater duration, and whether the maximum drawdown reached a subsequent recovery to its prior peak.
- A recovery is recorded only when cumulative wealth reaches or exceeds the previous peak. If the series ends below that peak, recovery remains false and no recovery date is invented.
- Requires at least 30 common consecutive portfolio return observations and current marks no older than 30 seconds. No positions, stale marks, missing symbols or insufficient contiguous history produce explicit unavailable statuses.
- LONG/SHORT direction is reflected through signed net exposure weights. This is a historical path diagnostic, not an actual account equity curve, forecast, maximum-loss bound or trade recommendation.
- Read-only: no PAPER position, risk limit, signal approval or order is changed; `executionEligible=false` and `exchangeOrderSent=false` remain invariant.


## Portfolio Recovery Analytics
- Extends the historical drawdown diagnostic with a sampled underwater curve (maximum 120 points), period counts, recovered/unrecovered counts, average recovery duration in candle observations, and the longest observed underwater episode.
- A drawdown episode begins when the reconstructed wealth index falls below its prior peak and ends only when it reaches or exceeds that peak. A period still below its peak at the end of the sample is marked unrecovered; no recovery date is fabricated.
- The server retains up to the eight most recent episodes with peak date, trough date, depth, duration and recovery state. The UI displays the sampled drawdown curve and a chronological comparison of those episodes.
- Average recovery duration includes only completed/recovered episodes; if none have recovered, the value is unavailable rather than zero.
- The curve is sampled for display only; aggregate metrics and episode states are calculated from the full longest uninterrupted return path. The 30-observation minimum, exact common timestamps, consecutive intervals, fresh mark requirement and static-current-exposure approximation remain unchanged.
- This remains a historical reconstruction using current signed net exposure weights, not actual historical account NAV or a forecast. It does not change positions, limits, signal approvals or orders.
