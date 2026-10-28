# Corpus sources

Third-party files are copied **unmodified** (renamed to `.pine`) and stay under their original license. They are test data only, not part of the distributed package (`files` in package.json excludes `corpus/`). Snapshot taken 2026-10-28.

| file | upstream path | repo @ commit | license |
|---|---|---|---|
| real/arun_magnetic_zones_mtf.pine | `[Indicator] Magnetic Zones - Multi Timeframe.txt` | [ArunKBhaskar/PineScript](https://github.com/ArunKBhaskar/PineScript) @ c682122 | MPL-2.0 (repo LICENSE + per-file header) |
| real/arun_liquidity_void_mtf.pine | `ICT Liquidity Void/ICT Liquidity Void Multi-timeframe.txt` | [ArunKBhaskar/PineScript](https://github.com/ArunKBhaskar/PineScript) @ c682122 | MPL-2.0 (repo LICENSE + per-file header) |
| real/arun_equal_highs_lows.pine | `ICT Equal Highs and Lows/ICT Equal Highs and Lows Indicator.txt` | [ArunKBhaskar/PineScript](https://github.com/ArunKBhaskar/PineScript) @ c682122 | MPL-2.0 (repo LICENSE + per-file header) |
| real/arun_mss.pine | `ICT Market Structure Shift (MSS)/ICT Market Structure Shift (MSS).txt` | [ArunKBhaskar/PineScript](https://github.com/ArunKBhaskar/PineScript) @ c682122 | MPL-2.0 (repo LICENSE + per-file header) |
| real/arun_trend_following.pine | `Trend Following Setup - Sideways Market Skipper Scanner/Indicator - Trend Following Setup - Sideways Market Skipper.txt` | [ArunKBhaskar/PineScript](https://github.com/ArunKBhaskar/PineScript) @ c682122 | MPL-2.0 (repo LICENSE + per-file header) |
| real/arun_liquidity_void_fill.pine | `ICT Liquidity Void Fill/[Indicator] ICT Liquidity Void Fill.txt` | [ArunKBhaskar/PineScript](https://github.com/ArunKBhaskar/PineScript) @ c682122 | MPL-2.0 (repo LICENSE + per-file header) |
| real/geraked_3MAF.pine | `strategies/3MAF.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_ABSAR.pine | `strategies/ABSAR.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_BBRSI.pine | `strategies/BBRSI.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_CEZLSMA.pine | `strategies/CEZLSMA.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_CP1.pine | `strategies/CP1.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_DHLAOS.pine | `strategies/DHLAOS.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_LRCUTB.pine | `strategies/LRCUTB.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_MLCEL_MACD.pine | `strategies/MLCEL_MACD.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/geraked_NWERSIASF.pine | `strategies/NWERSIASF.pine` | [geraked/tradingview](https://github.com/geraked/tradingview) @ 4938294 | MIT |
| real/mihakralj_pivot.pine | `indicators/reversals/pivot.pine` | [mihakralj/pinescript](https://github.com/mihakralj/pinescript) @ c4e91b9 | MIT |
| real/mihakralj_pivotfib.pine | `indicators/reversals/pivotfib.pine` | [mihakralj/pinescript](https://github.com/mihakralj/pinescript) @ c4e91b9 | MIT |
| real/mihakralj_prs.pine | `indicators/momentum/prs.pine` | [mihakralj/pinescript](https://github.com/mihakralj/pinescript) @ c4e91b9 | MIT |
| real/mihakralj_covariance.pine | `indicators/statistics/covariance.pine` | [mihakralj/pinescript](https://github.com/mihakralj/pinescript) @ c4e91b9 | MIT |
| real/mihakralj_spearman.pine | `indicators/statistics/spearman.pine` | [mihakralj/pinescript](https://github.com/mihakralj/pinescript) @ c4e91b9 | MIT |
| real/mihakralj_coral.pine | `indicators/trends_IIR/coral.pine` | [mihakralj/pinescript](https://github.com/mihakralj/pinescript) @ c4e91b9 | MIT |
| real/mihakralj_dema.pine | `indicators/trends_IIR/dema.pine` | [mihakralj/pinescript](https://github.com/mihakralj/pinescript) @ c4e91b9 | MIT |

All files in `fixtures/` are written for this project (MIT). Several re-implement, in our own code, the patterns described on the TradingView repainting page (https://www.tradingview.com/pine-script-docs/concepts/repainting/); the docs' own example code was **not** copied because the docs carry no explicit open-source license.

## Considered and skipped

- `Ahmed-GoCode/Quant-Edge-Indicators`: GitHub shows MPL-2.0 metadata, but the LICENSE file says "All rights reserved" → unclear, skipped (it would have been the only real source with `alertcondition` + `timenow`).
- `everget/tradingview-pinescript-indicators`, `pinecoders/pine-utils` (GPL-3.0): skipped to keep the repo free of GPL test data.
- `LuxAlgo/PineTS` (AGPL-3.0): skipped.
- TradingView public library scripts: per-script licenses vary and scraping TradingView is against its ToS → not collected.
