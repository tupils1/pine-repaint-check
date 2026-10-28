#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const run_1 = require("./run");
const rules_1 = require("./rules");
const format_1 = require("./format");
const HELP = `pine-repaint-check ${format_1.VERSION}
Static repaint-risk checker for Pine Script v5/v6. Detection only.

Usage: pine-repaint-check [options] [paths...]   (default: .; scans *.pine, *.pinescript)

Options:
  -f, --format <text|json|sarif|github>  output format (default text)
      --fail-on <error|warning|info|none> exit 1 if any finding at/above (default error)
      --min-severity <info|warning|error> hide findings below (default info)
      --sarif-output <file>              also write SARIF to file
      --disable <PRC00x,...>             disable rules
      --list-rules                       print rules
  -h, --help | -v, --version
Suppress inline: // pine-repaint-check: ignore PRC005   (same line)
                 // pine-repaint-check: ignore-next-line PRC001
                 // pine-repaint-check: disable-file PRC006`;
function main(argv) {
    const o = { paths: [], format: 'text', failOn: 'error', minSeverity: 'info', disable: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => { const v = argv[++i]; if (v === undefined)
            throw new Error(`${a} needs a value`); return v; };
        if (a === '-h' || a === '--help') {
            process.stdout.write(HELP + '\n');
            return 0;
        }
        else if (a === '-v' || a === '--version') {
            process.stdout.write(format_1.VERSION + '\n');
            return 0;
        }
        else if (a === '--list-rules') {
            for (const r of Object.values(rules_1.RULES))
                process.stdout.write(`${r.id} ${r.severity.padEnd(7)} ${r.name}\n    ${r.summary}\n    ${r.docs}\n`);
            return 0;
        }
        else if (a === '-f' || a === '--format')
            o.format = next();
        else if (a === '--fail-on')
            o.failOn = next();
        else if (a === '--min-severity')
            o.minSeverity = next();
        else if (a === '--sarif-output')
            o.sarifOutput = next();
        else if (a === '--disable')
            o.disable = next().split(',').map((s) => s.trim());
        else if (a.startsWith('-'))
            throw new Error(`unknown option ${a}`);
        else
            o.paths.push(a);
    }
    if (!['text', 'json', 'sarif', 'github'].includes(o.format))
        throw new Error(`invalid format ${o.format}`);
    return (0, run_1.run)(o, (s) => process.stdout.write(s));
}
try {
    process.exitCode = main(process.argv.slice(2));
}
catch (e) {
    process.stderr.write(`pine-repaint-check: ${e.message}\n`);
    process.exitCode = 2;
}
