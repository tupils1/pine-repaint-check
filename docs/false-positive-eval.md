# False-positive sample

Judged hits from a random sample of public Pine scripts that contain `lookahead_on`. The checker under test is the parent of the precision fixes in this pull request. Those fixes are listed at the end; they do not add rules.

A hit is a **false positive** when the matched code does not have the property the rule claims. Repainting that the rule is written to report is a **true positive**, including uses that are often acceptable: `varip`, `timenow`, an unconfirmed `alert()`, a pivot drawn on `bar_index[n]`, and `lookahead_on` applied to the current bar. TradingView's own page treats several of those as real behavior, not as checker mistakes.

## Sampling frame

GitHub code search for `lookahead_on extension:pine` (forks excluded by the API default) reported `total_count` **2336** on 2026-10-28. The search API returns at most 1000 hits per query, so `scripts/fp-sample.mjs enumerate` splits the query on file size until every partition has fewer than 1000 hits, then pages through it.

The crawl took long enough that the index moved. Partition totals sum to 2562, and the deduped list has **2617** unique `repo + path` entries (`corpus/fp-eval/population.json`, `retrievedAt` 2026-10-28T22:05:58Z). A follow-up query `size:>5000000` returned 0 files. The sample is a simple random sample of that frozen list, not a redraw of the morning count of 2336.

## Sample

- Seed `20261028`, n = 200.
- Sort the frame by `repo + NUL + path`.
- Fisher-Yates with `mulberry32(seed)` (see `scripts/fp-sample.mjs`).
- Keep the first 200, then sort again so the ids are stable.
- Reproduce with `node scripts/fp-sample.mjs sample` after `population.json` is present. `node scripts/fp-sample.mjs selftest` checks the shuffle and the Wilson interval.

`enumerate` and `fetch` need the GitHub CLI (`gh`) authenticated. Code search has a 10/minute quota and a secondary 429 that turns into a long cooldown if several retries arrive close together. The script waits out a short `Retry-After` once, then waits 12 minutes instead of poking again.

## What was stored

Each of the 200 files was fetched at the blob SHA from the search result. A file is copied into `corpus/fp-eval/files/` only when its license is MIT, Apache-2.0, MPL-2.0, BSD-2-Clause, or BSD-3-Clause:

- GitHub's detected repo license, or
- a header in the first 80 lines (SPDX, the MPL-2.0 Pine header, the Apache-2.0 header, or the MIT permission sentence).

A copyleft repo license conflicts with a permissive header, so the file is not stored. Anything else is URL-only in `corpus/fp-eval/manifest.json`.

| decision | files |
|---|---:|
| stored, MPL-2.0 | 32 |
| stored, MIT | 11 |
| stored, Apache-2.0 | 1 |
| URL only (no clear permissive license) | 142 |
| URL only (repo license not permissive, or it conflicts with the header) | 14 |

Non-permissive sources are not in git. `scan` reads them from the local fetch cache (`FP_CACHE`, default `/tmp/fp-eval-cache`) and otherwise tells you to run `fetch` again.

## How hits were judged

`node scripts/fp-sample.mjs scan` on the pre-fix checker produced 1942 hits (`corpus/fp-eval/findings-judged.json`). `corpus/fp-eval/labels.json` has one verdict per hit.

Judgment rules, applied per hit and then corrected by reading the borderline cases:

- **PRC001 / PRC002.** True positive when the `request.security` expression reads the current bar of the requested context (`close`, `ta.sma(close, n)`, a function that returns the current bar, `high[0]`, a ternary that still has a current-bar branch). False positive when every flagged expression is made only of prior-bar values and constants (`green[1] ? true : false`, `ta.sma(high - low, n)[1] / close[1] * 100`).
- **PRC003.** `calc_on_every_tick = true` on a real `strategy()` call.
- **PRC004 / PRC005.** A real `varip` or `timenow`, not a comment or string. Both necessarily differ between history and realtime.
- **PRC006.** Any real `barstate.isnew`, `isrealtime`, `islastconfirmedhistory`, or `islast` that feeds a signal, an alert, a `request.*`, or a value used after the block. False positive when `barstate.islast` only updates a table, label, line, or box, or only logs, and nothing it assigns is used as a signal afterward. Two `islast` blocks in `s0033` run trade-transition checks; those stay true positives.
- **PRC007.** False positive when the call passes `alert.freq_once_per_bar_close` or the condition is already `barstate.isconfirmed` or a `[1]` series. `alert.freq_once_per_bar` (without `_close`) still fires intrabar, so it stays a true positive.
- **PRC008.** A negative plot `offset`, or a drawing anchored on `bar_index[n]` / `bar_index - n`. Pivot labels are true positives: that is the plotting-in-the-past behavior the rule names.

## Precision

Wilson score interval, 95% (`z = 1.959963984540054`). Precision is TP / (TP + FP). The false-positive rate is FP / (TP + FP). Files with no hit for a rule do not enter that rule's denominator. `node scripts/fp-sample.mjs report` reprints this table from `findings-judged.json` and `labels.json`.

| rule | hits | TP | FP | precision | 95% CI | FP rate | 95% CI |
|---|---:|---:|---:|---:|---|---:|---|
| PRC001 security-lookahead-future-leak | 333 | 329 | 4 | 98.8% | 97.0%–99.5% | 1.2% | 0.5%–3.0% |
| PRC002 security-htf-unconfirmed | 292 | 292 | 0 | 100% | 98.7%–100.0% | 0% | 0%–1.3% |
| PRC003 calc-on-every-tick | 6 | 6 | 0 | 100% | 61.0%–100.0% | 0% | 0%–39.0% |
| PRC004 varip | 31 | 31 | 0 | 100% | 89.0%–100.0% | 0% | 0%–11.0% |
| PRC005 timenow | 46 | 46 | 0 | 100% | 92.3%–100.0% | 0% | 0%–7.7% |
| PRC006 barstate-realtime-dependent | 352 | 196 | 156 | 55.7% | 50.5%–60.8% | 44.3% | 39.2%–49.5% |
| PRC007 alert-unconfirmed | 591 | 587 | 4 | 99.3% | 98.3%–99.7% | 0.7% | 0.3%–1.7% |
| PRC008 plot-in-the-past | 291 | 291 | 0 | 100% | 98.7%–100.0% | 0% | 0%–1.3% |

PRC003 has only six hits, so its interval is wide. PRC002, PRC004, PRC005, and PRC008 had no false positives in this sample; the upper end of the interval is the useful number.

`barstate.islast` findings are severity **info**. `isnew`, `isrealtime`, `ishistory`, and `islastconfirmedhistory` stay at PRC006's severity, which is also info. The Action default `min-severity=warning` therefore does not show `islast` hits (nor the other PRC006 hits). The CLI default remains `info`, so it still prints them. On the judged sample:

| PRC006 builtin | hits | TP | FP | precision | 95% CI | FP rate | 95% CI |
|---|---:|---:|---:|---:|---|---:|---|
| islast (info; hidden at warning) | 260 | 104 | 156 | 40.0% | 34.2%–46.1% | 60.0% | 53.9%–65.8% |
| isnew / isrealtime / islastconfirmedhistory (info) | 92 | 92 | 0 | 100.0% | 96.0%–100.0% | 0.0% | 0.0%–4.0% |

The 60% false-positive rate is the `islast` slice (156 of 260). The other barstate builtins had no false positives (52 `islastconfirmedhistory`, 37 `isrealtime`, 3 `isnew`). `node scripts/fp-sample.mjs report` prints this split under the main table.

## False-positive patterns

**PRC006, last-bar drawing (156 of 352 hits).** `barstate.islast` that only fills a dashboard, deletes and recreates labels or lines, or logs. The checker already skips a simple `if barstate.islast` whose body is `table.*` / `label.*` / `line.*` / `box.*` or `runtime.error`. It missed the common forms: `lb := label.new(...)` when `lb` is declared outside the `if`, `lb.delete()` / `boxes.clear()`, `for lb in labels`, and a dashboard that computes a local string or color before `table.cell`. That is the dominant false-positive pattern in this sample. `barstate.isrealtime`, `isnew`, and `islastconfirmedhistory` did not show the same class of miss; those hits matched the documented historical-versus-realtime difference.

**PRC001, already-historical expression (4 of 333).** Three copies of `green[1] ? true : false`, and `ta.sma(high - low, adrLength)[1] / close[1] * 100.0`. The `[1]` is real, but it is not a bare `expr[1]`, so the old check still reported a future leak. A ternary that still has a current-bar branch, such as `rep ? price : price[1]`, stays a true positive.

**PRC007, `alertcondition` already limited to bar close (4 of 591).** All four are in one script and pass `alert.freq_once_per_bar_close`. The checker honored that argument on `alert()` and not on `alertcondition()`. An unclosed string earlier in the file also made the reported line numbers two early, which is why the calls were easy to misread.

No false positives turned up for PRC002, PRC003, PRC004, PRC005, or PRC008. PRC002 hits are higher-timeframe (or other-timeframe) requests of a current-bar series without the `[1]` + `lookahead_on` pair. PRC008 hits are negative offsets and drawings on an earlier `bar_index`, including ordinary pivot labels.

## Fixes from this sample

No new rules.

- PRC001 no longer reports an expression built only from prior-bar values: a trailing `[n]` with n ≠ 0, arithmetic or a comparison or a ternary of those values, and `int` / `float` / `nz` / `math.abs` (and the other pure numeric wrappers) of such values. `close`, `high[0]`, and `rep ? price : price[1]` are still reported.
- `alertcondition(..., alert.freq_once_per_bar_close)` is treated like the same argument on `alert()`.
- An unclosed string no longer consumes the newline, so later findings keep their line numbers.
- `barstate.islast` is not reported when the body only draws and the only assignments are new locals or `lb := label.new` / `line.new` / `box.new` / `table.new`, including `for lb in boxes` with `lb.delete()`. An `alert()`, `plot()`, or `request.*` inside the `if`, or `y := close`, is still reported.
- Remaining `barstate.islast` hits are severity info, so `min-severity=warning` (the Action default) does not show them. `isnew`, `isrealtime`, `ishistory`, and `islastconfirmedhistory` stay at PRC006's severity (info).

On this sample the post-fix checker reports 1886 hits (was 1942): PRC001 327 (was 333), PRC006 306 (was 352), PRC007 587 (was 591). The four PRC001 historical-expression false positives and the four PRC007 bar-close false positives are gone. About 46 `barstate.islast` hits are gone; the ones inspected were dashboards, label rebinding, or an `islast` match inside a string whose newline had been skipped. 120 judged display-only `islast` hits remain, mostly dashboards that do local arithmetic or call a `draw*` helper before `table.cell`. Those were left in place rather than widening the suppression until it starts hiding `islast` blocks that compute a signal.

The hand labels above are the pre-fix measurement. Re-running `scan` writes `findings.json` for the current checker, which will not match `labels.json` line for line.
