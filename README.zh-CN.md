# pine-repaint-check

[English](README.md)

基于规则的 **TradingView Pine Script v5/v6 重绘风险静态检查器**（也识别 v4 的 `security()`），提供 CLI 和 GitHub Action。不调大模型、不联网、不访问 TradingView，只读你本地已有的 `.pine` 文件。

> **范围：只做检测和告警。** 本项目不提供、也不会提供 webhook、券商对接或自动下单功能。

TradingView 官方估计 95% 以上的指标都有某种形式的重绘，其中很多是可以接受的（[文档](https://www.tradingview.com/pine-script-docs/concepts/repainting/)），所以结果是**分级告警**，不是简单的"重绘/不重绘"。

## 规则

| 编号 | 级别 | 检查内容 |
|---|---|---|
| PRC001 | error | `request.security(..., lookahead = barmerge.lookahead_on)` 而表达式没加 `[1]`：历史 K 线上泄漏未来数据。表达式是包装函数参数时降为 warning |
| PRC002 | warning | 请求其他周期的 `request.security()` 没用 `[1]` + `lookahead_on`：实时 K 线返回未确认的值 |
| PRC003 | warning | 策略使用 `calc_on_every_tick = true` |
| PRC004 | warning | 使用 `varip` |
| PRC005 | warning | 使用 `timenow` |
| PRC006 | info | `barstate.isnew / isrealtime / islast / ishistory / islastconfirmedhistory` |
| PRC007 | warning | `alertcondition()` / `alert()` 没有用 `barstate.isconfirmed`、`[1]` 偏移或 `alert.freq_once_per_bar_close` 把关 |
| PRC008 | info | 负 `offset` 的绘图，或在 `bar_index[n]` / `bar_index - n` 处画 label/line/box（画到过去） |

每条规则的依据都对应官方重绘文档的一节，链接见英文 README。数据修订、图表起点变化、非标准图表等无法静态检测，不在范围内。

## 命令行

```bash
npx pine-repaint-check src/                 # 文本输出，有 error 时退出码 1
npx pine-repaint-check -f json .
npx pine-repaint-check -f sarif . > out.sarif
npx pine-repaint-check --fail-on warning --disable PRC006 .
```
退出码：`0` 正常；`1` 有达到 `--fail-on`（默认 `error`）级别的问题；`2` 参数错误。

## 行内抑制

```pine
x = time > timenow - 86400000      // pine-repaint-check: ignore PRC005
// pine-repaint-check: ignore-next-line PRC001
// pine-repaint-check: disable-file PRC006
```

## GitHub Action

```yaml
- uses: tupils1/pine-repaint-check@v0   # 尚未发布
  with:
    paths: scripts/
    fail-on: error
    sarif-output: pine.sarif
```
结果会作为 PR 注释（annotation）显示，也可以把 SARIF 上传到 Code scanning。

## 准确率

在 22 个许可证明确的真实脚本和 21 个自写用例上实测，见 [corpus/RESULTS.md](corpus/RESULTS.md)。真实样本少、标注由作者人工完成，数字只能当作初步参考。

已知局限：基于正则和括号匹配，不是完整语法解析；标识符只在单文件内追一层赋值；函数内的 alert 不分析调用处；不跟踪 `import` 的库。

## 许可证

MIT。`corpus/real/` 下的第三方文件保留原许可证（MIT / MPL-2.0），见 `corpus/SOURCES.md`。
