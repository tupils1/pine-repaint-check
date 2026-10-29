"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const run_1 = require("./run");
const input = (n, d) => (process.env[`INPUT_${n.replace(/ /g, '_').toUpperCase()}`] ?? '').trim() || d;
try {
    const paths = input('paths', '.').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    const code = (0, run_1.run)({
        paths, format: 'github', failOn: input('fail-on', 'error'), minSeverity: input('min-severity', 'warning'),
        sarifOutput: input('sarif-output', '') || undefined, disable: input('disable', '').split(',').map((s) => s.trim()).filter(Boolean),
    }, (s) => process.stdout.write(s));
    process.exitCode = code;
}
catch (e) {
    process.stdout.write(`::error::pine-repaint-check: ${e.message}\n`);
    process.exitCode = 2;
}
