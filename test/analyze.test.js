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

test('PRC002 only for other timeframes', () => {
  assert.deepStrictEqual(ids(hdr + 'a = request.security(syminfo.tickerid, "240", close)\nb = request.security("X", timeframe.period, close)\nc = request.security("X", "", close)'), ['PRC002@3']);
  assert.deepStrictEqual(ids(hdr + 'a = request.security_lower_tf(syminfo.tickerid, "1", close)'), []);
});

test('PRC003-PRC006 keywords', () => {
  assert.deepStrictEqual(ids('//@version=6\nstrategy("s", calc_on_every_tick = true)'), ['PRC003@2']);
  assert.deepStrictEqual(ids('//@version=6\nstrategy("s", calc_on_every_tick = false)'), []);
  assert.deepStrictEqual(ids(hdr + 'varip int n = 0\nx = timenow\nif barstate.isnew\n    n := 0\ny = barstate.isconfirmed'), ['PRC004@3', 'PRC005@4', 'PRC006@5']);
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
