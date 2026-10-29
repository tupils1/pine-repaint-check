const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { analyze, toSARIF, toGitHub, toJSON, exitCode } = require('../dist/index.js');

const ids = (src) => analyze(src).map((f) => `${f.ruleId}@${f.line}`);
const hdr = '//@version=6\nindicator("t")\n';

test('PRC001 future leak, named and positional', () => {
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", high, lookahead = barmerge.lookahead_on)'), ['PRC001@3']);
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", high, barmerge.gaps_off, barmerge.lookahead_on)'), ['PRC001@3']);
  assert.strictEqual(analyze(hdr + 'x = request.security(syminfo.tickerid, "D", high, lookahead = barmerge.lookahead_on)')[0].severity, 'error');
});

test('PRC001 ignores a historical combination under lookahead_on', () => {
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", close[1] > open[1] ? 1 : 0, lookahead = barmerge.lookahead_on)'), []);
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", ta.sma(high - low, 14)[1] / close[1] * 100, lookahead = barmerge.lookahead_on)'), []);
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "60", close[1] > high ? 1 : 0, lookahead = barmerge.lookahead_on)'), ['PRC001@3']);
  assert.deepStrictEqual(ids(hdr + 'rep = true\nprice = close\nx = request.security(syminfo.tickerid, timeframe.period, (rep ? price : price[1]), lookahead = barmerge.lookahead_on)'), ['PRC001@5']);
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", int(time[1]), lookahead = barmerge.lookahead_on)'), []);
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", int(close), lookahead = barmerge.lookahead_on)'), ['PRC001@3']);
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "W", sma20)'), ['PRC002@3']);
});

test('unclosed string does not shift later line numbers', () => {
  assert.deepStrictEqual(ids(hdr + 's = "oops\nx = timenow\n'), ['PRC005@4']);
});

test('alertcondition freq_once_per_bar_close is not an unconfirmed alert', () => {
  assert.deepStrictEqual(ids(hdr + 'alertcondition(close > open, "t", "m", alert.freq_once_per_bar_close)\n'), []);
  assert.deepStrictEqual(ids(hdr + 'alertcondition(close > open, "t", "m", alert.freq_once_per_bar)\n'), ['PRC007@3']);
});

test('PRC006 islast is info; other barstate builtins keep the rule severity', () => {
  const src = hdr + 'v = barstate.islast ? close : na\nif barstate.isrealtime\n    x = close\nif barstate.isnew\n    y = close\nif barstate.ishistory\n    z = close\nif barstate.islastconfirmedhistory\n    w = close\n';
  const got = analyze(src).filter((f) => f.ruleId === 'PRC006');
  const by = (name) => got.find((f) => f.message.startsWith('barstate.' + name));
  assert.strictEqual(by('islast').severity, 'info');
  for (const name of ['isrealtime', 'isnew', 'ishistory', 'islastconfirmedhistory']) assert.strictEqual(by(name).severity, 'info', name);
  const rank = { info: 1, warning: 2, error: 3 };
  const atWarning = analyze(src).filter((f) => rank[f.severity] >= rank.warning);
  assert.ok(!atWarning.some((f) => /barstate\.islast\b/.test(f.message)));
});

test('PRC006 allows rebinding a drawing on the last bar', () => {
  const src = hdr + 'var label lb = na\nif barstate.islast\n    label.delete(lb)\n    lb := label.new(bar_index, high, "x")\n';
  assert.deepStrictEqual(ids(src), []);
  const loop = hdr + 'var array<label> lbs = array.new<label>()\nif barstate.islast\n    for lb in lbs\n        lb.delete()\n';
  assert.deepStrictEqual(ids(loop), []);
  assert.deepStrictEqual(ids(hdr + 'float y = na\nif barstate.islast\n    y := close\n'), ['PRC006@4']);
});

test('PRC001 not raised for [1] offset, safe atoms, comments, strings', () => {
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", high[1], lookahead = barmerge.lookahead_on)'), []);
  assert.deepStrictEqual(ids(hdr + '[t, tc] = request.security(syminfo.tickerid, "D", [time, time_close], lookahead = barmerge.lookahead_on)'), []);
  assert.deepStrictEqual(ids(hdr + '// x = request.security(syminfo.tickerid, "D", high, lookahead = barmerge.lookahead_on)'), []);
  assert.deepStrictEqual(ids(hdr + 's = "request.security(a, \\"D\\", high, lookahead = barmerge.lookahead_on)"'), []);
  assert.deepStrictEqual(ids(hdr + 'x = request.security(syminfo.tickerid, "D", high[0], lookahead = barmerge.lookahead_on)'), ['PRC001@3']);
});

test('PRC001 wrapper parameter is downgraded to warning', () => {
  const f = analyze(hdr + 'f(tf, p) =>\n    request.security(syminfo.tickerid, tf, p, lookahead = barmerge.lookahead_on)\n');
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].severity, 'warning');
});

test('PRC001 wrapper is silent when every same-file call passes an offset', () => {
  const ok = hdr + [
    'f(tf, p) =>',
    '    request.security(syminfo.tickerid, tf, p, lookahead = barmerge.lookahead_on)',
    'a = f("D", high[1])',
    'b = f("D", close[2])',
    'c = close[1]',
    'd = f("W", c)',
  ].join('\n');
  assert.deepStrictEqual(ids(ok), []);
  const dyn = hdr + [
    'f(tf, p) =>',
    '    request.security(syminfo.tickerid, tf, p, lookahead = barmerge.lookahead_on)',
    'n = 1',
    'a = f("D", close[n])',
    'b = f("D", close[barstate.isrealtime ? 1 : 0])',
  ].join('\n');
  assert.deepStrictEqual(ids(dyn), ['PRC006@7']);
  const bad = hdr + [
    'f(tf, p) =>',
    '    request.security(syminfo.tickerid, tf, p, lookahead = barmerge.lookahead_on)',
    'a = f("D", high[1])',
    'b = f("D", close)',
  ].join('\n');
  const f = analyze(bad);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].ruleId, 'PRC001');
  assert.strictEqual(f[0].severity, 'warning');
});

test('PRC001 wrapper call sites that pass a [1]-derived series are not reported', () => {
  const src = hdr + [
    'zones(float multiplier) =>',
    '    prev = high[1] - low[1]',
    '    r = hl2[1] + multiplier * prev',
    '    s = hl2[1] - multiplier * prev',
    '    [r, s]',
    '[r1, s1] = zones(0.236)',
    'data(timeframe, price) =>',
    '    request.security(syminfo.tickerid, timeframe, price, lookahead = barmerge.lookahead_on)',
    'a = data("D", high[1])',
    'b = data("D", r1)',
    'c = data("D", s1)',
  ].join('\n');
  assert.deepStrictEqual(ids(src), []);
  assert.deepStrictEqual(ids(src.replace(/\n/g, '\r\n')), []);
  const leak = src + '\nd = data("D", close)\n';
  const f = analyze(leak);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'warning');
});

test('PRC002 only for other timeframes', () => {
  assert.deepStrictEqual(ids(hdr + 'a = request.security(syminfo.tickerid, "240", close)\nb = request.security("X", timeframe.period, close)\nc = request.security("X", "", close)'), ['PRC002@3']);
  assert.deepStrictEqual(ids(hdr + 'a = request.security_lower_tf(syminfo.tickerid, "1", close)'), []);
});

test('PRC003-PRC006 keywords', () => {
  assert.deepStrictEqual(ids('//@version=6\nstrategy("s", calc_on_every_tick = true)'), ['PRC003@2']);
  assert.deepStrictEqual(ids('//@version=6\nstrategy("s", calc_on_every_tick = false)'), []);
  assert.deepStrictEqual(ids(hdr + 'varip int n = 0\nx = timenow\nif barstate.isnew\n    n := 0\ny = barstate.isconfirmed'), ['PRC004@3', 'PRC005@4', 'PRC006@5']);
});

test('PRC006 ignores barstate.islast that only draws or notifies', () => {
  const table = hdr + 'if barstate.islast and show\n    table.cell(tbl, 0, 0, "x")\n    table.cell(tbl, 1, 0, "y")\n';
  assert.deepStrictEqual(ids(table), []);
  const label = hdr + 'if barstate.islast\n    label.new(bar_index, high, "last")\n';
  assert.deepStrictEqual(ids(label), []);
  const notice = hdr + 'if barstate.islast and ta.cum(volume) == 0\n    runtime.error("No volume is provided by the data vendor.")\n';
  assert.deepStrictEqual(ids(notice), []);
  const dash = hdr + [
    'if barstate.islast and show',
    '    string title = "ROW"',
    '    var table dash = table.new(position.top_right, 2, 2)',
    '    int r = 0',
    '    table.cell(dash, 0, r, title)',
    '    r += 1',
    '    table.cell(dash, 0, r, syminfo.ticker)',
  ].join('\n');
  assert.deepStrictEqual(ids(dash), []);
  assert.deepStrictEqual(ids(hdr + 'v = barstate.islast ? close : na\n'), ['PRC006@3']);
  const repaint = hdr + 'float y = na\nif barstate.islast\n    y := close\n    line.new(bar_index, y, bar_index[1], y[1])\n';
  assert.deepStrictEqual(ids(repaint), ['PRC006@4', 'PRC008@6']);
  const leaked = hdr + 'if barstate.islast\n    x = 1\nplot(x)\n';
  assert.ok(ids(leaked).includes('PRC006@3'));
});

test('PRC007 alert gating', () => {
  const src = hdr + [
    'a = ta.crossover(close, open)',
    'b = a and barstate.isconfirmed',
    'alertcondition(a, "a")',
    'alertcondition(b, "b")',
    'if a',
    '    alert("x")',
    'if b',
    '    alert("y")',
    'if a',
    '    alert("z", alert.freq_once_per_bar_close)',
  ].join('\n');
  assert.deepStrictEqual(ids(src), ['PRC007@5', 'PRC007@8']);
});

test('PRC008 plotting in the past', () => {
  assert.deepStrictEqual(ids(hdr + 'plot(close, offset = -3)\nplot(close, offset = 2)\nlabel.new(bar_index[5], high, "p")\nlabel.new(bar_index, high, "n")'), ['PRC008@3', 'PRC008@5']);
});

test('suppressions', () => {
  const src = hdr + [
    'x = timenow // pine-repaint-check: ignore PRC005',
    '// pine-repaint-check: ignore-next-line',
    'y = timenow',
    'z = timenow // pine-repaint-check: ignore PRC004',
  ].join('\n');
  assert.deepStrictEqual(ids(src), ['PRC005@6']);
  assert.deepStrictEqual(ids('// pine-repaint-check: disable-file\n' + hdr + 'x = timenow'), []);
});

test('BOM and CRLF', () => {
  assert.deepStrictEqual(ids('\uFEFF//@version=6\r\nindicator("t")\r\nx = timenow\r\n'), ['PRC005@3']);
});

test('formatters and exit codes', () => {
  const f = analyze(hdr + 'x = request.security(syminfo.tickerid, "D", high, lookahead = barmerge.lookahead_on)\ny = timenow', 'a.pine');
  const sarif = JSON.parse(toSARIF(f));
  assert.strictEqual(sarif.version, '2.1.0');
  assert.strictEqual(sarif.runs[0].results.length, 2);
  assert.strictEqual(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 3);
  assert.match(toGitHub(f), /^::error file=a\.pine,line=3,col=5,title=PRC001/);
  assert.strictEqual(JSON.parse(toJSON(f, 1)).summary.error, 1);
  assert.strictEqual(exitCode(f, 'error'), 1);
  assert.strictEqual(exitCode(f.filter((x) => x.severity !== 'error'), 'error'), 0);
  assert.strictEqual(exitCode(f.filter((x) => x.severity !== 'error'), 'warning'), 1);
  assert.strictEqual(exitCode(f, 'none'), 0);
});

test('every fixture matches its expect markers', () => {
  const dir = path.join(__dirname, '..', 'corpus', 'fixtures');
  for (const file of fs.readdirSync(dir).filter((x) => x.endsWith('.pine'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const expected = [];
    src.split('\n').forEach((l, i) => { const m = /expect:\s*((?:PRC\d{3}[ ,]*)+)/.exec(l); if (m) m[1].match(/PRC\d{3}/g).forEach((r) => expected.push(`${r}@${i + 1}`)); });
    assert.deepStrictEqual(ids(src).sort(), expected.sort(), file);
  }
});

test('CLI: exit codes, json, sarif file', () => {
  const cli = path.join(__dirname, '..', 'dist', 'cli.js');
  const fx = path.join(__dirname, '..', 'corpus', 'fixtures');
  assert.strictEqual(spawnSync(process.execPath, [cli, path.join(fx, 'clean_rsi.pine')]).status, 0);
  assert.strictEqual(spawnSync(process.execPath, [cli, path.join(fx, 'leak_basic.pine')]).status, 1);
  assert.strictEqual(spawnSync(process.execPath, [cli, '--fail-on', 'none', path.join(fx, 'leak_basic.pine')]).status, 0);
  assert.strictEqual(spawnSync(process.execPath, [cli, '--fail-on', 'warning', path.join(fx, 'timenow_filter.pine')]).status, 1);
  assert.strictEqual(spawnSync(process.execPath, [cli, '--bogus']).status, 2);
  const out = JSON.parse(execFileSync(process.execPath, [cli, '-f', 'json', '--fail-on', 'none', fx]).toString());
  assert.ok(out.filesScanned >= 20);
  const tmp = path.join(require('node:os').tmpdir(), `prc-${process.pid}.sarif`);
  spawnSync(process.execPath, [cli, '--sarif-output', tmp, '--fail-on', 'none', fx]);
  assert.ok(JSON.parse(fs.readFileSync(tmp, 'utf8')).runs[0].results.length > 0);
});

test('Action entrypoint reads INPUT_* env', () => {
  const action = path.join(__dirname, '..', 'dist', 'action.js');
  const r = spawnSync(process.execPath, [action], { env: { ...process.env, INPUT_PATHS: path.join(__dirname, '..', 'corpus', 'fixtures', 'leak_basic.pine'), 'INPUT_FAIL-ON': 'error' } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout.toString(), /::error file=.*leak_basic\.pine,line=3/);
});

test('Action default min-severity is warning', () => {
  const action = path.join(__dirname, '..', 'dist', 'action.js');
  const infoOnly = path.join(__dirname, '..', 'corpus', 'fixtures', 'varip_counter.pine');
  const hidden = spawnSync(process.execPath, [action], { env: { ...process.env, INPUT_PATHS: infoOnly, 'INPUT_FAIL-ON': 'none' } });
  assert.strictEqual(hidden.status, 0);
  assert.doesNotMatch(hidden.stdout.toString(), /PRC006/);
  assert.match(hidden.stdout.toString(), /PRC004/);
  const shown = spawnSync(process.execPath, [action], { env: { ...process.env, INPUT_PATHS: infoOnly, 'INPUT_FAIL-ON': 'none', 'INPUT_MIN-SEVERITY': 'info' } });
  assert.match(shown.stdout.toString(), /PRC006/);
  const both = path.join(require('node:os').tmpdir(), `prc-barstate-${process.pid}.pine`);
  fs.writeFileSync(both, '//@version=6\nindicator("t")\nv = barstate.islast ? close : na\nif barstate.isrealtime\n    x = close\n');
  const def = spawnSync(process.execPath, [action], { env: { ...process.env, INPUT_PATHS: both, 'INPUT_FAIL-ON': 'none' } });
  assert.strictEqual(def.status, 0);
  assert.doesNotMatch(def.stdout.toString(), /islast/);
  assert.doesNotMatch(def.stdout.toString(), /isrealtime/);
  const info = spawnSync(process.execPath, [action], { env: { ...process.env, INPUT_PATHS: both, 'INPUT_FAIL-ON': 'none', 'INPUT_MIN-SEVERITY': 'info' } });
  assert.match(info.stdout.toString(), /::notice .*barstate\.islast /);
  assert.match(info.stdout.toString(), /::notice .*barstate\.isrealtime /);
  assert.doesNotMatch(info.stdout.toString(), /::warning .*barstate\.islast /);
  assert.doesNotMatch(info.stdout.toString(), /::warning .*barstate\.isrealtime /);
});
