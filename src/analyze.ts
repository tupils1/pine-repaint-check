import { lex, lineOf, colOf, matchBracket, splitTop, Lexed } from './lexer';
import { RULES, Severity } from './rules';

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  line: number;
  column: number;
  file: string;
  docs: string;
}

interface Arg { name?: string; text: string; start: number; end: number; }
interface Call { name: string; start: number; open: number; close: number; args: Arg[]; }

const SAFE_ATOMS = /^(time|time_close|open|bar_index|na|true|false|barstate\.isconfirmed|syminfo\.\w+|timeframe\.\w+|-?\d+(\.\d+)?|"[^"]*"|'[^']*')$/;
const HISTORY_OFFSET = /\[\s*([^\]\s][^\]]*)\]\s*$/;

function findCalls(lx: Lexed, re: RegExp): Call[] {
  const calls: Call[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lx.masked))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(lx.masked, open);
    if (close < 0) continue;
    const args = splitTop(lx.masked, open + 1, close).map(([s, e]) => {
      const raw = lx.code.slice(s, e);
      const nm = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(lx.masked.slice(s, e));
      if (nm) return { name: nm[1], text: raw.slice(nm[0].length).trim(), start: s, end: e };
      return { text: raw.trim(), start: s, end: e };
    });
    calls.push({ name: m[1] ?? m[0], start: m.index + (m[0].length - m[0].trimStart().length), open, close, args });
  }
  return calls;
}

function arg(call: Call, name: string, pos: number): Arg | undefined {
  const named = call.args.find((a) => a.name === name);
  if (named) return named;
  const positional = call.args.filter((a) => !a.name);
  // positional args only count while no named arg precedes them
  const idx = call.args.findIndex((a) => a.name);
  if (idx >= 0 && pos >= idx) return undefined;
  return positional[pos];
}

function norm(s: string): string { return s.replace(/\s+/g, ' ').trim(); }

function tupleElems(expr: string): string[] {
  const e = expr.trim();
  if (e.startsWith('[') && matchBracket(e, 0) === e.length - 1) {
    return splitTop(e, 1, e.length - 1).map(([s, t]) => e.slice(s, t).trim());
  }
  return [e];
}

/** Trailing [n] indexes this whole expression, and n is not 0. */
function suffixAnchorsAll(e: string): boolean {
  if (!e.endsWith(']')) return false;
  let i = e.length - 1;
  let d = 0;
  for (; i >= 0; i--) {
    if (e[i] === ']') d++;
    else if (e[i] === '[') { d--; if (d === 0) break; }
  }
  if (i <= 0) return false;
  let depth = 0;
  for (let k = 0; k < i; k++) {
    const c = e[k];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && '+-*/%?:<>=!'.includes(c)) return false;
  }
  const inside = e.slice(i + 1, e.length - 1).trim();
  if (inside === '0') return false;
  if (e.startsWith('[') && matchBracket(e, 0) === e.length - 1) return false;
  return true;
}

/** Depth-0 arithmetic / ternary cuts. Unary minus is not a cut. */
function depth0Ops(e: string): number[] {
  const cuts: number[] = [];
  let d = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') d--;
    else if (d === 0) {
      const unaryMinus = c === '-' && (i === 0 || '+-*/%?:<>=!(['.includes(e[i - 1]));
      if (!unaryMinus && '+-*/%?:<>=!'.includes(c)) cuts.push(i);
    }
  }
  return cuts;
}

/**
 * Value is taken from a bar before the current one: a trailing `[n]` with n ≠ 0,
 * or an arithmetic / ternary combination of such values and constants.
 * `close[1] ? 1 : 0` and `ta.sma(close, 14)[1] / close[1]` do not read the current bar.
 */
function historicallyAnchored(expr: string, depth = 0): boolean {
  if (depth > 6) return false;
  let e = norm(expr);
  if (!e) return true;
  while (e.startsWith('(') && matchBracket(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
  if (!e) return true;
  if (SAFE_ATOMS.test(e) || /^-?\d+(\.\d+)?$/.test(e)) return true;
  if (suffixAnchorsAll(e)) return true;
  const call = /^([A-Za-z_][\w.]*)\s*\(/.exec(e);
  if (call && /^(?:int|float|bool|string|nz|math\.(?:abs|round|floor|ceil|sign|log|log10|sqrt|max|min))$/.test(call[1])) {
    const open = call[0].length - 1;
    if (matchBracket(e, open) === e.length - 1) {
      const args = splitTop(e, open + 1, e.length - 1).map(([s, t]) => e.slice(s, t).trim()).filter(Boolean);
      if (args.length === 0 || args.every((a) => historicallyAnchored(a, depth + 1))) return true;
    }
  }
  const cuts = depth0Ops(e);
  if (!cuts.length) return false;
  const clean = (p: string) => p.replace(/^[!=<>]+/, '').replace(/[!=<>]+$/, '').trim();
  const parts: string[] = [];
  let from = 0;
  for (const i of cuts) { parts.push(clean(e.slice(from, i))); from = i + 1; }
  parts.push(clean(e.slice(from)));
  const kept = parts.filter(Boolean);
  return kept.length > 1 && kept.every((p) => historicallyAnchored(p, depth + 1));
}

function hasOffset(el: string): boolean {
  const e = el.trim();
  const m = HISTORY_OFFSET.exec(e);
  if (!m) return false;
  // whole thing is a tuple literal -> not an offset
  if (e.startsWith('[') && matchBracket(e, 0) === e.length - 1) return false;
  const off = m[1].trim();
  if (/^\d+$/.test(off)) return Number(off) >= 1;
  return true; // dynamic offset (e.g. barstate.isrealtime ? 1 : 0): cannot prove, assume intentional
}

/** Logical statement defining `ident` (latest definition before `before`). */
function defOf(lx: Lexed, ident: string, before: number): string | undefined {
  const lines = lx.masked.slice(0, before).split('\n');
  const codeLines = lx.code.slice(0, before).split('\n');
  const re = new RegExp(`^(\\s*)(?:var\\s+|varip\\s+)?(?:[A-Za-z_][\\w.<>]*\\s+)?${ident.replace('.', '\\.')}\\s*:?=(?!=)(.*)$`);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let text = codeLines[i].slice(codeLines[i].indexOf('=') + 1);
    for (let j = i + 1; j < codeLines.length; j++) {
      const l = codeLines[j];
      if (l.trim() === '') break;
      const ind = l.length - l.trimStart().length;
      if (ind <= indent) break;
      text += ' ' + l.trim();
    }
    return text;
  }
  return undefined;
}

function paramList(list: string): string[] {
  return list.split(',').map((p) => p.trim().split(/\s+/).pop()!.replace(/=.*/, '').trim()).filter(Boolean);
}

interface FnSig { name: string; params: string[]; }

function enclosingFunction(lx: Lexed, offset: number): FnSig | undefined {
  const line = lineOf(lx, offset);
  const lines = lx.masked.split('\n');
  for (let i = line - 1; i >= 0; i--) {
    const l = lines[i];
    const fm = /^(?:export\s+)?(?:method\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>/.exec(l);
    if (fm) return { name: fm[1], params: paramList(fm[2]) };
    if (i < line - 1 && /^\S/.test(l) && l.trim() !== '') return undefined; // reached top-level statement
  }
  return undefined;
}

interface UserFn { params: string[]; bodyEnd: number; returns: string[]; }

function findUserFn(lx: Lexed, name: string): UserFn | undefined {
  const lines = lx.masked.split('\n');
  const codeLines = lx.code.split('\n');
  const sig = new RegExp(`^(?:export\\s+)?(?:method\\s+)?${name}\\s*\\(([^)]*)\\)\\s*=>`);
  for (let i = 0; i < lines.length; i++) {
    const fm = sig.exec(lines[i]);
    if (!fm) continue;
    const sigIndent = lines[i].length - lines[i].trimStart().length;
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].length - lines[j].trimStart().length <= sigIndent) break;
      last = j;
    }
    const bodyIdx: number[] = [];
    for (let j = i + 1; j <= last; j++) if (codeLines[j].trim() !== '') bodyIdx.push(j);
    const minInd = bodyIdx.reduce((m, j) => Math.min(m, codeLines[j].length - codeLines[j].trimStart().length), Infinity);
    const starts = bodyIdx.filter((j) => codeLines[j].length - codeLines[j].trimStart().length === minInd);
    const retLine = starts.length ? starts[starts.length - 1] : last;
    let ret = codeLines[retLine]?.trim() ?? '';
    for (let j = retLine + 1; j <= last; j++) {
      if (codeLines[j].trim() === '') continue;
      if (codeLines[j].length - codeLines[j].trimStart().length <= minInd) break;
      ret += ' ' + codeLines[j].trim();
    }
    const bodyEnd = last + 1 < lx.lineStarts.length ? lx.lineStarts[last + 1] : lx.code.length;
    return { params: paramList(fm[1]), bodyEnd, returns: ret ? tupleElems(ret) : [] };
  }
  return undefined;
}

function parseTopCall(expr: string): { name: string; args: string[] } | undefined {
  const e = expr.trim();
  const m = /^([A-Za-z_]\w*)\s*\(/.exec(e);
  if (!m) return undefined;
  const open = m[0].length - 1;
  if (matchBracket(e, open) !== e.length - 1) return undefined;
  const close = e.length - 1;
  if (e.slice(open + 1, close).trim() === '') return { name: m[1], args: [] };
  return { name: m[1], args: splitTop(e, open + 1, close).map(([s, t]) => e.slice(s, t).trim()) };
}

interface PScope { at: number; params: Map<string, { expr: string; at: number }>; }

function zipParams(params: string[], args: string[], at: number): Map<string, { expr: string; at: number }> {
  const out = new Map<string, { expr: string; at: number }>();
  const positional: string[] = [];
  for (const a of args) {
    const nm = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(a.trim());
    if (nm && params.includes(nm[1])) out.set(nm[1], { expr: nm[2].trim(), at });
    else positional.push(a.trim());
  }
  let p = 0;
  for (const name of params) if (!out.has(name) && p < positional.length) out.set(name, { expr: positional[p++], at });
  return out;
}

function tupleAssign(lx: Lexed, ident: string, before: number): { index: number; rhs: string; at: number } | undefined {
  const lines = lx.code.slice(0, before).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*\[([^\]]*)\]\s*=(?!=)\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const names = m[1].split(',').map((s) => s.trim().split(/\s+/).pop()!.replace(/=.*/, ''));
    const index = names.indexOf(ident);
    if (index < 0) continue;
    let rhs = m[2].trim();
    const indent = lines[i].length - lines[i].trimStart().length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') break;
      if (lines[j].length - lines[j].trimStart().length <= indent) break;
      rhs += ' ' + lines[j].trim();
    }
    return { index, rhs, at: lx.lineStarts[i] ?? 0 };
  }
  return undefined;
}

const SKIP_WORDS = new Set(['and', 'or', 'not', 'true', 'false', 'na', 'if', 'else', 'for', 'to', 'by', 'switch']);
const SAFE_NS = /^(syminfo|timeframe|color|size|position|shape|location|display|format|barmerge|chart|session|dayofweek|label|line|box|table|text|hline|font|xloc|yloc|extend)\./;

function isScalarish(a: string): boolean {
  const e = norm(a);
  return SAFE_ATOMS.test(e) || SAFE_NS.test(e);
}

/** Expression is anchored on a previous bar: [n>=1], a dynamic history offset, or built only from those. */
function isPastExpr(lx: Lexed, expr: string, scope: PScope, depth: number, stack: string[]): boolean {
  if (depth > 8) return false;
  const e = norm(expr);
  if (!e) return false;
  if (SAFE_ATOMS.test(e) || hasOffset(e)) return true;
  if (e.startsWith('[')) {
    const end = matchBracket(e, 0);
    if (end === e.length - 1) {
      const elems = tupleElems(e);
      return elems.length > 0 && elems.every((el) => isPastExpr(lx, el, scope, depth + 1, stack));
    }
  }
  if (/^[A-Za-z_]\w*$/.test(e)) {
    if (stack.includes(e)) return false;
    const bound = scope.params.get(e);
    if (bound) return isPastExpr(lx, bound.expr, { at: bound.at, params: new Map() }, depth + 1, stack.concat(e));
    const tup = tupleAssign(lx, e, scope.at);
    if (tup) {
      const call = parseTopCall(tup.rhs);
      const fn = call && findUserFn(lx, call.name);
      if (call && fn && tup.index < fn.returns.length) {
        return isPastExpr(lx, fn.returns[tup.index], { at: fn.bodyEnd, params: zipParams(fn.params, call.args, tup.at) }, depth + 1, stack.concat(e));
      }
      const elems = tupleElems(tup.rhs);
      if (tup.rhs.trim().startsWith('[') && tup.index < elems.length) {
        return isPastExpr(lx, elems[tup.index], scope, depth + 1, stack.concat(e));
      }
    }
    const d = defOf(lx, e, scope.at);
    if (d) return isPastExpr(lx, d, scope, depth + 1, stack.concat(e));
    return false;
  }
  const call = parseTopCall(e);
  if (call) {
    const fn = findUserFn(lx, call.name);
    if (fn) {
      const params = zipParams(fn.params, call.args, scope.at);
      const inner: PScope = { at: fn.bodyEnd, params };
      return fn.returns.length > 0 && fn.returns.every((r) => isPastExpr(lx, r, inner, depth + 1, stack));
    }
    return call.args.every((a) => isScalarish(a) || isPastExpr(lx, a, scope, depth + 1, stack));
  }
  return compoundIsPast(lx, e, scope, depth, stack);
}

function compoundIsPast(lx: Lexed, expr: string, scope: PScope, depth: number, stack: string[]): boolean {
  const e = norm(expr);
  let i = 0;
  while (i < e.length) {
    if (!/[A-Za-z_]/.test(e[i])) { i++; continue; }
    const m = /^[A-Za-z_][\w.]*/.exec(e.slice(i))!;
    const word = m[0];
    let j = i + word.length;
    if (SKIP_WORDS.has(word)) { i = j; continue; }
    const rest = e.slice(j);
    const off = /^\s*(\[[^\]]*\])/.exec(rest);
    if (off) {
      if (!hasOffset(word + off[1].replace(/\s+/g, ''))) return false;
      i = j + off[0].length;
      continue;
    }
    if (/^\s*\(/.test(rest)) {
      const open = j + rest.indexOf('(');
      const close = matchBracket(e, open);
      if (close < 0) return false;
      const args = splitTop(e, open + 1, close).map(([s, t]) => e.slice(s, t).trim()).filter(Boolean);
      if (!args.every((a) => isScalarish(a) || isPastExpr(lx, a, scope, depth + 1, stack))) return false;
      i = close + 1;
      continue;
    }
    if (word.includes('.') && SAFE_NS.test(word)) { i = j; continue; }
    if (SAFE_ATOMS.test(word)) { i = j; continue; }
    if (!isPastExpr(lx, word, scope, depth + 1, stack)) return false;
    i = j;
  }
  return true;
}

function wrapperCallsArePast(lx: Lexed, fnName: string, paramName: string, paramIndex: number): boolean {
  const calls = findCalls(lx, new RegExp(`(?<![\\w.])${fnName}\\s*\\(`, 'g'))
    .filter((c) => !/^\s*=>/.test(lx.masked.slice(c.close + 1, c.close + 16)));
  if (calls.length === 0) return false;
  return calls.every((c) => {
    const a = arg(c, paramName, paramIndex);
    return !!a && isPastExpr(lx, a.text, { at: c.start, params: new Map() }, 0, []);
  });
}

const DRAW_NS = '(?:table|label|line|box|polyline|linefill)';
const DRAW_START = new RegExp(`^${DRAW_NS}\\s*\\.\\s*[A-Za-z_]\\w*`);
const LOG_START = /^(?:runtime\s*\.\s*(?:error|log)|log\s*\.\s*(?:info|warning|error))\b/;
const ASSIGN_STMT = /^(?:(var|varip)\s+)?(?:(table|label|line|box|polyline|linefill|string|int|float|bool|color)\s+)?([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|:=|=(?!=))\s*([\s\S]+)$/;

function parenDelta(maskedLine: string): number {
  let d = 0;
  for (const c of maskedLine) {
    if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') d--;
  }
  return d;
}

function rhsSafe(rhs: string): boolean {
  const t = rhs.trim();
  if (new RegExp(`^${DRAW_NS}\\s*\\.\\s*[A-Za-z_]`).test(t)) return true;
  if (/\b(?:close|open|high|low|hl2|hlc3|ohlc4|hlcc4|volume|vwap)\b/.test(t)) return false;
  if (/\b(?:ta|request|strategy)\s*\./.test(t)) return false;
  if (/\b(?:alert|alertcondition|plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|bgcolor|barcolor)\s*\(/.test(t)) return false;
  return true;
}

function stmtOk(stmt: string, locals: Set<string>): boolean {
  const t = stmt.trim();
  if (DRAW_START.test(t) || LOG_START.test(t)) return true;
  // label.delete(lb) is covered by DRAW_START; lb.delete() / boxes.clear() are the method form.
  if (/\.\s*(?:delete|clear)\s*\(/.test(t)) return true;
  const m = ASSIGN_STMT.exec(t);
  if (!m) return false;
  const creates = m[4] === '=' || !!m[1];
  if (!rhsSafe(m[5])) return false;
  // `lb := label.new(...)` rebinds a drawing handle declared outside the if.
  const rebindsDrawing = new RegExp(`^${DRAW_NS}\\s*\\.\\s*new\\b`).test(m[5].trim());
  if (!creates && !locals.has(m[3]) && !rebindsDrawing) return false;
  if (creates) locals.add(m[3]);
  return true;
}

function blockOk(codeLines: string[], maskLines: string[], locals: Set<string>): boolean {
  const nonempty = codeLines.map((l, i) => i).filter((i) => codeLines[i].trim() !== '');
  if (!nonempty.length) return false;
  const indOf = (s: string) => s.length - s.trimStart().length;
  const base = Math.min(...nonempty.map((i) => indOf(codeLines[i])));
  let i = 0;
  while (i < codeLines.length) {
    if (codeLines[i].trim() === '') { i++; continue; }
    const ind = indOf(codeLines[i]);
    if (ind !== base) return false;
    let depth = parenDelta(maskLines[i]);
    const parts = [codeLines[i].trim()];
    let j = i + 1;
    while (j < codeLines.length && depth > 0) {
      if (codeLines[j].trim() !== '') parts.push(codeLines[j].trim());
      depth += parenDelta(maskLines[j]);
      j++;
    }
    const head = parts.join(' ');
    if (/^(?:else\s+)?if\b|^else\b|^for\b|^while\b|^switch\b/.test(head)) {
      const nestedC: string[] = [];
      const nestedM: string[] = [];
      while (j < codeLines.length) {
        if (codeLines[j].trim() === '') { j++; continue; }
        if (indOf(codeLines[j]) <= ind) break;
        nestedC.push(codeLines[j]);
        nestedM.push(maskLines[j]);
        j++;
      }
      if (nestedC.length && !blockOk(nestedC, nestedM, locals)) return false;
      i = j;
      continue;
    }
    if (!stmtOk(head, locals)) return false;
    i = j;
  }
  return true;
}

/** barstate.islast that only draws a table/label/line/box or raises a runtime notice on the last bar. */
function isHarmlessIslast(lx: Lexed, offset: number): boolean {
  const code = lx.code.split('\n');
  const mask = lx.masked.split('\n');
  const idx = lineOf(lx, offset) - 1;
  const line = code[idx] ?? '';
  if (!/^\s*if\b/.test(line) || /(?:=|:=)\s*if\b/.test(line) || !/\bbarstate\.islast\b/.test(line)) return false;
  const ind = line.length - line.trimStart().length;
  const bodyC: string[] = [];
  const bodyM: string[] = [];
  let end = idx + 1;
  for (let i = idx + 1; i < code.length; i++) {
    if (code[i].trim() === '') { end = i + 1; continue; }
    if (code[i].length - code[i].trimStart().length <= ind) { end = i; break; }
    bodyC.push(code[i]);
    bodyM.push(mask[i]);
    end = i + 1;
  }
  const locals = new Set<string>();
  if (!blockOk(bodyC, bodyM, locals)) return false;
  const rest = code.slice(end);
  for (const name of locals) {
    const re = new RegExp(`(?<![\\w.])${name}(?![\\w])`);
    if (rest.some((l) => re.test(l) && !DRAW_START.test(l.trim()) && !LOG_START.test(l.trim()))) return false;
  }
  return true;
}

function isConfirmedExpr(lx: Lexed, expr: string, at: number, depth = 0): boolean {
  if (/\bbarstate\.isconfirmed\b/.test(expr)) return true;
  if (/\)\s*\[\s*[1-9]\d*\s*\]\s*$/.test(expr.trim())) return true;
  if (depth >= 3) return false;
  const idents = new Set(expr.match(/(?<![\w.])[A-Za-z_]\w*(?![\w.(])/g) ?? []);
  for (const id of idents) {
    if (/^(and|or|not|true|false|na|close|open|high|low|volume)$/.test(id)) continue;
    const d = defOf(lx, id, at);
    if (d && isConfirmedExpr(lx, d, at, depth + 1)) return true;
  }
  return false;
}

function enclosingIfConditions(lx: Lexed, offset: number): { conds: string[]; inFunction: boolean } {
  const lines = lx.code.split('\n');
  const line = lineOf(lx, offset) - 1;
  let minIndent = lines[line].length - lines[line].trimStart().length;
  const conds: string[] = [];
  let inFunction = false;
  for (let i = line - 1; i >= 0 && minIndent > 0; i--) {
    const l = lines[i];
    if (l.trim() === '') continue;
    const ind = l.length - l.trimStart().length;
    if (ind >= minIndent) continue;
    minIndent = ind;
    const t = l.trim();
    const m = /^(?:else\s+)?if\s+(.*)$/.exec(t) ?? /^\S.*=\s*if\s+(.*)$/.exec(t);
    if (m) conds.push(m[1]);
    else if (/=>\s*$/.test(t)) inFunction = true;
  }
  return { conds, inFunction };
}

export function analyze(src: string, file = '<input>'): Finding[] {
  const lx = lex(src);
  const out: Finding[] = [];
  const add = (ruleId: string, offset: number, message: string, severity?: Severity) => {
    const r = RULES[ruleId];
    out.push({ ruleId, severity: severity ?? r.severity, message, line: lineOf(lx, offset), column: colOf(lx, offset), file, docs: r.docs });
  };

  // PRC001 / PRC002: request.security
  for (const c of findCalls(lx, /(?<![\w.])(request\.security|security)\s*\(/g)) {
    const tf = arg(c, 'timeframe', 1);
    const ex = arg(c, 'expression', 2);
    const la = arg(c, 'lookahead', 4);
    if (!ex) continue;
    const lookOn = !!la && /barmerge\.lookahead_on/.test(la.text);
    const elems = tupleElems(ex.text);
    const unsafe = elems.filter((e) => !SAFE_ATOMS.test(norm(e)) && !hasOffset(e) && !historicallyAnchored(e));
    if (lookOn) {
      if (unsafe.length === 0) continue;
      const fn = enclosingFunction(lx, c.start);
      const viaParam = !!fn && unsafe.every((e) => fn.params.includes(norm(e)));
      if (viaParam && fn) {
        const proven = unsafe.every((u) => {
          const name = norm(u);
          return wrapperCallsArePast(lx, fn.name, name, fn.params.indexOf(name));
        });
        if (!proven) add('PRC001', c.start, `lookahead_on with expression parameter '${unsafe.map(norm).join(', ')}' of a wrapper function: a same-file call site passes a series that is not offset by [1].`, 'warning');
      } else {
        const resolved = unsafe.filter((e) => {
          if (!/^[A-Za-z_]\w*$/.test(norm(e))) return true;
          const d = defOf(lx, norm(e), c.start);
          return !(d && hasOffset(d));
        });
        if (resolved.length) add('PRC001', c.start, `Future leak: lookahead_on without [1] offset on ${resolved.map((e) => '`' + norm(e) + '`').join(', ')}. Use expr[1] with lookahead_on.`);
      }
    } else {
      const tft = tf ? norm(tf.text) : '';
      if (!tf || /^(timeframe\.period|""|''|timeframe\.main_period)$/.test(tft)) continue;
      if (unsafe.length === 0) continue;
      add('PRC002', c.start, `Higher-timeframe request (${tft}) returns unconfirmed values on realtime bars for ${unsafe.map((e) => '`' + norm(e) + '`').join(', ')}. Use expr[1] with lookahead=barmerge.lookahead_on if you need non-repainting values.`);
    }
  }

  // PRC003: strategy(calc_on_every_tick = true)
  for (const c of findCalls(lx, /(?<![\w.])(strategy)\s*\(/g)) {
    const a = c.args.find((x) => x.name === 'calc_on_every_tick');
    if (a && /^true$/.test(a.text.trim())) add('PRC003', a.start + (lx.code.slice(a.start, a.end).length - lx.code.slice(a.start, a.end).trimStart().length), 'calc_on_every_tick = true: realtime fills will not match the backtest.');
  }

  // PRC004/5/6: keywords
  const kw: Array<[string, RegExp, (m: string) => string]> = [
    ['PRC004', /(?<![\w.])varip(?!\w)/g, () => 'varip state cannot be reproduced on historical bars; results are not backtestable.'],
    ['PRC005', /(?<![\w.])timenow(?!\w)/g, () => 'timenow depends on wall-clock time; historical and realtime output differ.'],
    ['PRC006', /(?<![\w.])barstate\.(isnew|isrealtime|islast|ishistory|islastconfirmedhistory)(?!\w)/g, (m) => `${m} behaves differently on historical vs realtime bars; check that signals/plots do not depend on it.`],
  ];
  for (const [id, re, msg] of kw) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(lx.masked))) {
      if (id === 'PRC006' && m[1] === 'islast' && isHarmlessIslast(lx, m.index)) continue;
      // islast is info so the Action default min-severity=warning hides it.
      // isnew / isrealtime / ishistory / islastconfirmedhistory keep PRC006's own severity.
      const severity = id === 'PRC006' && m[1] === 'islast' ? 'info' as const : undefined;
      add(id, m.index, msg(m[0]), severity);
    }
  }

  // PRC007: alerts
  for (const c of findCalls(lx, /(?<![\w.])(alertcondition)\s*\(/g)) {
    const cond = arg(c, 'condition', 0);
    if (!cond) continue;
    if (c.args.some((a) => /alert\.freq_once_per_bar_close/.test(a.text))) continue;
    if (!isConfirmedExpr(lx, cond.text, c.start)) add('PRC007', c.start, `alertcondition(${norm(cond.text).slice(0, 60)}) is not gated by barstate.isconfirmed; it may fire intrabar (unless users pick "Once Per Bar Close").`);
  }
  for (const c of findCalls(lx, /(?<![\w.])(alert)\s*\(/g)) {
    if (c.args.some((a) => /alert\.freq_once_per_bar_close/.test(a.text))) continue;
    const { conds, inFunction } = enclosingIfConditions(lx, c.start);
    if (conds.some((x) => isConfirmedExpr(lx, x, c.start))) continue;
    add('PRC007', c.start, `alert() fires without barstate.isconfirmed or alert.freq_once_per_bar_close${inFunction ? ' (inside a function; call site not analysed)' : ''}.`);
  }

  // PRC008: plotting in the past
  for (const c of findCalls(lx, /(?<![\w.])(plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|bgcolor|barcolor)\s*\(/g)) {
    const o = c.args.find((a) => a.name === 'offset');
    if (o && /^-/.test(o.text.trim()) && !/^-\s*0$/.test(o.text.trim())) add('PRC008', c.start, `${c.name}() with offset=${norm(o.text)} draws on past bars.`);
  }
  for (const c of findCalls(lx, /(?<![\w])(label\.new|line\.new|box\.new)\s*\(/g)) {
    const xs = c.args.filter((a, i) => (a.name ? /^(x|x1|x2|left|right)$/.test(a.name) : i === 0 || (c.name !== 'label.new' && i === 2)));
    const bad = xs.find((a) => /\bbar_index\s*\[\s*[^\]\s0][^\]]*\]|\bbar_index\s*-\s*[A-Za-z_(\d]/.test(a.text) && !/^\s*0\s*$/.test(a.text));
    if (bad) add('PRC008', c.start, `${c.name}() placed at ${norm(bad.text)} (past bar).`);
  }

  return applySuppressions(lx, out).sort((a, b) => a.line - b.line || a.column - b.column);
}

const SUPPRESS = /pine-repaint-check:\s*(ignore-next-line|ignore|disable-file)\b([\w\s,]*)/;

function applySuppressions(lx: Lexed, findings: Finding[]): Finding[] {
  const fileOff = new Set<string>();
  const lineOff = new Map<number, Set<string> | 'all'>();
  const put = (line: number, ids: string[]) => {
    if (ids.length === 0) { lineOff.set(line, 'all'); return; }
    const cur = lineOff.get(line);
    if (cur === 'all') return;
    const s = cur ?? new Set<string>();
    ids.forEach((i) => s.add(i));
    lineOff.set(line, s);
  };
  for (const [line, text] of lx.comments) {
    const m = SUPPRESS.exec(text);
    if (!m) continue;
    const ids = (m[2].match(/PRC\d{3}/g) ?? []);
    if (m[1] === 'disable-file') { if (ids.length === 0) fileOff.add('*'); ids.forEach((i) => fileOff.add(i)); }
    else put(m[1] === 'ignore' ? line : line + 1, ids);
  }
  return findings.filter((f) => {
    if (fileOff.has('*') || fileOff.has(f.ruleId)) return false;
    const l = lineOff.get(f.line);
    return !(l === 'all' || (l && l.has(f.ruleId)));
  });
}
