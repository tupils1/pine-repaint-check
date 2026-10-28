# pine-repaint-check

[简体中文](README.zh-CN.md)

Static, rule-based **repaint-risk checker for TradingView Pine Script v5/v6** (v4 `security()` also recognised). CLI + GitHub Action. No LLM, no network, no TradingView access: it only reads `.pine` files you already have.

> **Scope:** detection and warnings only. This project does not and will not provide webhook, broker or order-execution features.

TradingView itself estimates that >95% of indicators repaint in *some* way and that much of it is acceptable ([docs](https://www.tradingview.com/pine-script-docs/concepts/repainting/)). So findings are **graded**, not a yes/no verdict.

## Rules

| id | severity | what | source |
|---|---|---|---|
| PRC001 | error | `request.security(..., lookahead = barmerge.lookahead_on)` with an expression not offset by `[1]` → future leak on historical bars. Not reported when the expression is built only from prior-bar values. Warning when the expression is a wrapper-function parameter; not reported when every same-file call site passes a `[1]` (or other history) offset | [Future leak](https://www.tradingview.com/pine-script-docs/concepts/repainting/#future-leak-with-requestsecurity) |
| PRC002 | warning | `request.security()` on another timeframe without the `[1]` + `lookahead_on` pattern → unconfirmed realtime values | [Repainting request.security() calls](https://www.tradingview.com/pine-script-docs/concepts/repainting/#repainting-requestsecurity-calls) |
| PRC003 | warning | `strategy(..., calc_on_every_tick = true)` | [Strategies](https://www.tradingview.com/pine-script-docs/concepts/repainting/#strategies) |
| PRC004 | warning | `varip` | [varip](https://www.tradingview.com/pine-script-docs/concepts/repainting/#varip) |
| PRC005 | warning | `timenow` | [timenow](https://www.tradingview.com/pine-script-docs/concepts/repainting/#timenow) |
| PRC006 | info | `barstate.isnew / isrealtime / islast / ishistory / islastconfirmedhistory`. `barstate.islast` is not reported when it only draws a table/label/line/box or raises a runtime notice on the last bar | [Bar state built-ins](https://www.tradingview.com/pine-script-docs/concepts/repainting/#bar-state-built-ins) |
| PRC007 | warning | `alertcondition()` / `alert()` not gated by `barstate.isconfirmed`, a `[1]`-offset condition, or `alert.freq_once_per_bar_close` | [Fluid data values](https://www.tradingview.com/pine-script-docs/concepts/repainting/#fluid-data-values) |
| PRC008 | info | plots with negative `offset`, or `label/line/box.new` at `bar_index[n]` / `bar_index - n` | [Plotting in the past](https://www.tradingview.com/pine-script-docs/concepts/repainting/#plotting-in-the-past) |

Not detectable statically (documented as out of scope): data revisions, chart starting-point variations, non-standard chart types, `request.security()` to lower timeframes chosen via input.

## CLI

Not published to npm. Install from GitHub:

```bash
npx -y github:tupils1/pine-repaint-check src/                 # text, exit 1 on any error
npx -y github:tupils1/pine-repaint-check -f json .            # JSON
npx -y github:tupils1/pine-repaint-check -f sarif . > out.sarif
npx -y github:tupils1/pine-repaint-check --fail-on warning --min-severity warning --disable PRC006 .
npx -y github:tupils1/pine-repaint-check --list-rules
```

Exit codes: `0` ok, `1` findings at/above `--fail-on` (default `error`), `2` usage error. Scans `*.pine` and `*.pinescript`.

## Inline suppression

```pine
x = time > timenow - 86400000      // pine-repaint-check: ignore PRC005
// pine-repaint-check: ignore-next-line PRC001
d = request.security(syminfo.tickerid, "D", high, lookahead = barmerge.lookahead_on)
// pine-repaint-check: disable-file PRC006
```
Without rule ids, `ignore` / `ignore-next-line` / `disable-file` silence all rules.

## GitHub Action

```yaml
- uses: actions/checkout@v4
- uses: tupils1/pine-repaint-check@v1
  with:
    paths: scripts/
    fail-on: error          # error | warning | info | none
    min-severity: warning   # default. info | warning | error
    sarif-output: pine.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: pine.sarif }
```
Findings appear as PR annotations (`error` / `warning` / `notice`). The Action's default `min-severity` is `warning`, so info-level rules (PRC006, PRC008) are hidden unless you set `min-severity: info`. The CLI default remains `info`.

## Accuracy

Measured on a corpus of 31 real permissively-licensed scripts plus 21 own fixtures; see [corpus/RESULTS.md](corpus/RESULTS.md) and [corpus/SOURCES.md](corpus/SOURCES.md). A separate false-positive sample of 200 public `.pine` files that contain `lookahead_on` is written up in [docs/false-positive-eval.md](docs/false-positive-eval.md). The hand labels are a review of hits, not an external benchmark.

Known limitations: regex/bracket-based analysis, not a full parser; identifier resolution is one assignment deep within a file, except a `lookahead_on` wrapper parameter, which is checked at same-file call sites (including tuple returns of user functions); alerts inside user functions are flagged without checking call sites; libraries (`import`) are not followed.

## Develop

```bash
npm ci && npm test && npm run eval
```
`dist/` is committed (the Action runs it directly) and has no runtime dependencies.

## License

MIT. Files in `corpus/real/` keep their original licenses (MIT / Apache-2.0 / MPL-2.0), see `corpus/SOURCES.md`.
