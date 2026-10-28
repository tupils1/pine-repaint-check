"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyze = analyze;
const lexer_1 = require("./lexer");
const rules_1 = require("./rules");
const SAFE_ATOMS = /^(time|time_close|open|bar_index|na|true|false|barstate\.isconfirmed|syminfo\.\w+|timeframe\.\w+|-?\d+(\.\d+)?|"[^"]*"|'[^']*')$/;
const HISTORY_OFFSET = /\[\s*([^\]\s][^\]]*)\]\s*$/;
function findCalls(lx, re) {
    const calls = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lx.masked))) {
        const open = m.index + m[0].length - 1;
        const close = (0, lexer_1.matchBracket)(lx.masked, open);
        if (close < 0)
            continue;
        const args = (0, lexer_1.splitTop)(lx.masked, open + 1, close).map(([s, e]) => {
            const raw = lx.code.slice(s, e);
            const nm = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(lx.masked.slice(s, e));
            if (nm)
                return { name: nm[1], text: raw.slice(nm[0].length).trim(), start: s, end: e };
            return { text: raw.trim(), start: s, end: e };
        });
        calls.push({ name: m[1] ?? m[0], start: m.index + (m[0].length - m[0].trimStart().length), open, close, args });
    }
    return calls;
}
function arg(call, name, pos) {
    const named = call.args.find((a) => a.name === name);
    if (named)
        return named;
    const positional = call.args.filter((a) => !a.name);
    // positional args only count while no named arg precedes them
    const idx = call.args.findIndex((a) => a.name);
    if (idx >= 0 && pos >= idx)
        return undefined;
    return positional[pos];
}
function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
function tupleElems(expr) {
    const e = expr.trim();
    if (e.startsWith('[') && (0, lexer_1.matchBracket)(e, 0) === e.length - 1) {
        return (0, lexer_1.splitTop)(e, 1, e.length - 1).map(([s, t]) => e.slice(s, t).trim());
    }
    return [e];
}
function hasOffset(el) {
    const e = el.trim();
    const m = HISTORY_OFFSET.exec(e);
    if (!m)
        return false;
    // whole thing is a tuple literal -> not an offset
    if (e.startsWith('[') && (0, lexer_1.matchBracket)(e, 0) === e.length - 1)
        return false;
    const off = m[1].trim();
    if (/^\d+$/.test(off))
        return Number(off) >= 1;
    return true; // dynamic offset (e.g. barstate.isrealtime ? 1 : 0): cannot prove, assume intentional
}
/** Logical statement defining `ident` (latest definition before `before`). */
function defOf(lx, ident, before) {
    const lines = lx.masked.slice(0, before).split('\n');
    const codeLines = lx.code.slice(0, before).split('\n');
    const re = new RegExp(`^(\\s*)(?:var\\s+|varip\\s+)?(?:[A-Za-z_][\\w.<>]*\\s+)?${ident.replace('.', '\\.')}\\s*:?=(?!=)(.*)$`);
    for (let i = lines.length - 1; i >= 0; i--) {
        const m = re.exec(lines[i]);
        if (!m)
            continue;
        const indent = m[1].length;
        let text = codeLines[i].slice(codeLines[i].indexOf('=') + 1);
        for (let j = i + 1; j < codeLines.length; j++) {
            const l = codeLines[j];
            if (l.trim() === '')
                break;
            const ind = l.length - l.trimStart().length;
            if (ind <= indent)
                break;
            text += ' ' + l.trim();
        }
        return text;
    }
    return undefined;
}
function enclosingParams(lx, offset) {
    const line = (0, lexer_1.lineOf)(lx, offset);
    const lines = lx.masked.split('\n');
    for (let i = line - 1; i >= 0; i--) {
        const l = lines[i];
        const fm = /^(?:method\s+)?[A-Za-z_]\w*\s*\(([^)]*)\)\s*=>/.exec(l);
        if (fm) {
            return fm[1].split(',').map((p) => p.trim().split(/\s+/).pop().replace(/=.*/, '').trim()).filter(Boolean);
        }
        if (i < line - 1 && /^\S/.test(l) && l.trim() !== '')
            return undefined; // reached top-level statement
    }
    return undefined;
}
function isConfirmedExpr(lx, expr, at, depth = 0) {
    if (/\bbarstate\.isconfirmed\b/.test(expr))
        return true;
    if (/\)\s*\[\s*[1-9]\d*\s*\]\s*$/.test(expr.trim()))
        return true;
    if (depth >= 3)
        return false;
    const idents = new Set(expr.match(/(?<![\w.])[A-Za-z_]\w*(?![\w.(])/g) ?? []);
    for (const id of idents) {
        if (/^(and|or|not|true|false|na|close|open|high|low|volume)$/.test(id))
            continue;
        const d = defOf(lx, id, at);
        if (d && isConfirmedExpr(lx, d, at, depth + 1))
            return true;
    }
    return false;
}
function enclosingIfConditions(lx, offset) {
    const lines = lx.code.split('\n');
    const line = (0, lexer_1.lineOf)(lx, offset) - 1;
    let minIndent = lines[line].length - lines[line].trimStart().length;
    const conds = [];
    let inFunction = false;
    for (let i = line - 1; i >= 0 && minIndent > 0; i--) {
        const l = lines[i];
        if (l.trim() === '')
            continue;
        const ind = l.length - l.trimStart().length;
        if (ind >= minIndent)
            continue;
        minIndent = ind;
        const t = l.trim();
        const m = /^(?:else\s+)?if\s+(.*)$/.exec(t) ?? /^\S.*=\s*if\s+(.*)$/.exec(t);
        if (m)
            conds.push(m[1]);
        else if (/=>\s*$/.test(t))
            inFunction = true;
    }
    return { conds, inFunction };
}
function analyze(src, file = '<input>') {
    const lx = (0, lexer_1.lex)(src);
    const out = [];
    const add = (ruleId, offset, message, severity) => {
        const r = rules_1.RULES[ruleId];
        out.push({ ruleId, severity: severity ?? r.severity, message, line: (0, lexer_1.lineOf)(lx, offset), column: (0, lexer_1.colOf)(lx, offset), file, docs: r.docs });
    };
    // PRC001 / PRC002: request.security
    for (const c of findCalls(lx, /(?<![\w.])(request\.security|security)\s*\(/g)) {
        const tf = arg(c, 'timeframe', 1);
        const ex = arg(c, 'expression', 2);
        const la = arg(c, 'lookahead', 4);
        if (!ex)
            continue;
        const lookOn = !!la && /barmerge\.lookahead_on/.test(la.text);
        const elems = tupleElems(ex.text);
        const unsafe = elems.filter((e) => !SAFE_ATOMS.test(norm(e)) && !hasOffset(e));
        if (lookOn) {
            if (unsafe.length === 0)
                continue;
            const params = enclosingParams(lx, c.start) ?? [];
            const viaParam = unsafe.every((e) => params.includes(norm(e)));
            if (viaParam) {
                add('PRC001', c.start, `lookahead_on with expression parameter '${unsafe.join(', ')}' of a wrapper function: every call site must pass a [1]-offset series.`, 'warning');
            }
            else {
                const resolved = unsafe.filter((e) => {
                    if (!/^[A-Za-z_]\w*$/.test(norm(e)))
                        return true;
                    const d = defOf(lx, norm(e), c.start);
                    return !(d && hasOffset(d));
                });
                if (resolved.length)
                    add('PRC001', c.start, `Future leak: lookahead_on without [1] offset on ${resolved.map((e) => '`' + norm(e) + '`').join(', ')}. Use expr[1] with lookahead_on.`);
            }
        }
        else {
            const tft = tf ? norm(tf.text) : '';
            if (!tf || /^(timeframe\.period|""|''|timeframe\.main_period)$/.test(tft))
                continue;
            if (unsafe.length === 0)
                continue;
            add('PRC002', c.start, `Higher-timeframe request (${tft}) returns unconfirmed values on realtime bars for ${unsafe.map((e) => '`' + norm(e) + '`').join(', ')}. Use expr[1] with lookahead=barmerge.lookahead_on if you need non-repainting values.`);
        }
    }
    // PRC003: strategy(calc_on_every_tick = true)
    for (const c of findCalls(lx, /(?<![\w.])(strategy)\s*\(/g)) {
        const a = c.args.find((x) => x.name === 'calc_on_every_tick');
        if (a && /^true$/.test(a.text.trim()))
            add('PRC003', a.start + (lx.code.slice(a.start, a.end).length - lx.code.slice(a.start, a.end).trimStart().length), 'calc_on_every_tick = true: realtime fills will not match the backtest.');
    }
    // PRC004/5/6: keywords
    const kw = [
        ['PRC004', /(?<![\w.])varip(?!\w)/g, () => 'varip state cannot be reproduced on historical bars; results are not backtestable.'],
        ['PRC005', /(?<![\w.])timenow(?!\w)/g, () => 'timenow depends on wall-clock time; historical and realtime output differ.'],
        ['PRC006', /(?<![\w.])barstate\.(isnew|isrealtime|islast|ishistory|islastconfirmedhistory)(?!\w)/g, (m) => `${m} behaves differently on historical vs realtime bars; check that signals/plots do not depend on it.`],
    ];
    for (const [id, re, msg] of kw) {
        let m;
        while ((m = re.exec(lx.masked)))
            add(id, m.index, msg(m[0]));
    }
    // PRC007: alerts
    for (const c of findCalls(lx, /(?<![\w.])(alertcondition)\s*\(/g)) {
        const cond = arg(c, 'condition', 0);
        if (!cond)
            continue;
        if (!isConfirmedExpr(lx, cond.text, c.start))
            add('PRC007', c.start, `alertcondition(${norm(cond.text).slice(0, 60)}) is not gated by barstate.isconfirmed; it may fire intrabar (unless users pick "Once Per Bar Close").`);
    }
    for (const c of findCalls(lx, /(?<![\w.])(alert)\s*\(/g)) {
        if (c.args.some((a) => /alert\.freq_once_per_bar_close/.test(a.text)))
            continue;
        const { conds, inFunction } = enclosingIfConditions(lx, c.start);
        if (conds.some((x) => isConfirmedExpr(lx, x, c.start)))
            continue;
        add('PRC007', c.start, `alert() fires without barstate.isconfirmed or alert.freq_once_per_bar_close${inFunction ? ' (inside a function; call site not analysed)' : ''}.`);
    }
    // PRC008: plotting in the past
    for (const c of findCalls(lx, /(?<![\w.])(plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|bgcolor|barcolor)\s*\(/g)) {
        const o = c.args.find((a) => a.name === 'offset');
        if (o && /^-/.test(o.text.trim()) && !/^-\s*0$/.test(o.text.trim()))
            add('PRC008', c.start, `${c.name}() with offset=${norm(o.text)} draws on past bars.`);
    }
    for (const c of findCalls(lx, /(?<![\w])(label\.new|line\.new|box\.new)\s*\(/g)) {
        const xs = c.args.filter((a, i) => (a.name ? /^(x|x1|x2|left|right)$/.test(a.name) : i === 0 || (c.name !== 'label.new' && i === 2)));
        const bad = xs.find((a) => /\bbar_index\s*\[\s*[^\]\s0][^\]]*\]|\bbar_index\s*-\s*[A-Za-z_(\d]/.test(a.text) && !/^\s*0\s*$/.test(a.text));
        if (bad)
            add('PRC008', c.start, `${c.name}() placed at ${norm(bad.text)} (past bar).`);
    }
    return applySuppressions(lx, out).sort((a, b) => a.line - b.line || a.column - b.column);
}
const SUPPRESS = /pine-repaint-check:\s*(ignore-next-line|ignore|disable-file)\b([\w\s,]*)/;
function applySuppressions(lx, findings) {
    const fileOff = new Set();
    const lineOff = new Map();
    const put = (line, ids) => {
        if (ids.length === 0) {
            lineOff.set(line, 'all');
            return;
        }
        const cur = lineOff.get(line);
        if (cur === 'all')
            return;
        const s = cur ?? new Set();
        ids.forEach((i) => s.add(i));
        lineOff.set(line, s);
    };
    for (const [line, text] of lx.comments) {
        const m = SUPPRESS.exec(text);
        if (!m)
            continue;
        const ids = (m[2].match(/PRC\d{3}/g) ?? []);
        if (m[1] === 'disable-file') {
            if (ids.length === 0)
                fileOff.add('*');
            ids.forEach((i) => fileOff.add(i));
        }
        else
            put(m[1] === 'ignore' ? line : line + 1, ids);
    }
    return findings.filter((f) => {
        if (fileOff.has('*') || fileOff.has(f.ruleId))
            return false;
        const l = lineOff.get(f.line);
        return !(l === 'all' || (l && l.has(f.ruleId)));
    });
}
