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
