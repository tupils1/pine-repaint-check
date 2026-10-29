"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lex = lex;
exports.lineOf = lineOf;
exports.colOf = colOf;
exports.matchBracket = matchBracket;
exports.splitTop = splitTop;
function lex(src) {
    // `$`-anchored line matches treat `\r` as a non-dot character, so normalize newlines first.
    src = src.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const code = src.split('');
    const masked = src.split('');
    const comments = new Map();
    const lineStarts = [0];
    let line = 1;
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '\n') {
            lineStarts.push(i + 1);
            line++;
            i++;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') {
            let j = i;
            while (j < src.length && src[j] !== '\n')
                j++;
            comments.set(line, (comments.get(line) ?? '') + src.slice(i + 2, j));
            for (let k = i; k < j; k++) {
                code[k] = ' ';
                masked[k] = ' ';
            }
            i = j;
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c && src[j] !== '\n') {
                if (src[j] === '\\')
                    j++;
                j++;
            }
            for (let k = i + 1; k < j && k < src.length; k++)
                masked[k] = ' ';
            i = j + 1;
            continue;
        }
        i++;
    }
    return { src, code: code.join(''), masked: masked.join(''), lineStarts, comments };
}
function lineOf(lx, offset) {
    let lo = 0, hi = lx.lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lx.lineStarts[mid] <= offset)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo + 1;
}
function colOf(lx, offset) {
    return offset - lx.lineStarts[lineOf(lx, offset) - 1] + 1;
}
/** Index of the bracket matching the one at `open`, using the masked view. */
function matchBracket(masked, open) {
    const pairs = { '(': ')', '[': ']' };
    const stack = [];
    for (let i = open; i < masked.length; i++) {
        const c = masked[i];
        if (c === '(' || c === '[')
            stack.push(pairs[c]);
        else if (c === ')' || c === ']') {
            if (stack.pop() !== c)
                return -1;
            if (stack.length === 0)
                return i;
        }
    }
    return -1;
}
/** Split a range at top-level commas; returns [start,end) ranges. */
function splitTop(masked, start, end) {
    const out = [];
    let depth = 0, s = start;
    for (let i = start; i < end; i++) {
        const c = masked[i];
        if (c === '(' || c === '[')
            depth++;
        else if (c === ')' || c === ']')
            depth--;
        else if (c === ',' && depth === 0) {
            out.push([s, i]);
            s = i + 1;
        }
    }
    if (masked.slice(s, end).trim() !== '' || out.length)
        out.push([s, end]);
    return out;
}
