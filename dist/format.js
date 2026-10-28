"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = void 0;
exports.toText = toText;
exports.count = count;
exports.toJSON = toJSON;
exports.toSARIF = toSARIF;
exports.toGitHub = toGitHub;
exports.exitCode = exitCode;
const rules_1 = require("./rules");
exports.VERSION = '0.1.0';
function toText(findings, filesScanned) {
    const lines = findings.map((f) => `${f.file}:${f.line}:${f.column}  ${f.severity.padEnd(7)} ${f.ruleId} ${rules_1.RULES[f.ruleId].name}  ${f.message}`);
    const c = count(findings);
    lines.push('', `${filesScanned} file(s) scanned: ${c.error} error, ${c.warning} warning, ${c.info} info.`);
    return lines.join('\n');
}
function count(findings) {
    const c = { error: 0, warning: 0, info: 0 };
    findings.forEach((f) => c[f.severity]++);
    return c;
}
function toJSON(findings, filesScanned) {
    return JSON.stringify({ tool: 'pine-repaint-check', version: exports.VERSION, filesScanned, summary: count(findings), findings }, null, 2);
}
const SARIF_LEVEL = { error: 'error', warning: 'warning', info: 'note' };
function toSARIF(findings) {
    return JSON.stringify({
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [{
                tool: { driver: {
                        name: 'pine-repaint-check', version: exports.VERSION, informationUri: 'https://github.com/tupils1/pine-repaint-check',
                        rules: Object.values(rules_1.RULES).map((r) => ({ id: r.id, name: r.name, shortDescription: { text: r.summary }, helpUri: r.docs, defaultConfiguration: { level: SARIF_LEVEL[r.severity] } })),
                    } },
                results: findings.map((f) => ({
                    ruleId: f.ruleId, level: SARIF_LEVEL[f.severity], message: { text: f.message },
                    locations: [{ physicalLocation: { artifactLocation: { uri: f.file.replace(/\\/g, '/') }, region: { startLine: f.line, startColumn: f.column } } }],
                })),
            }],
    }, null, 2);
}
const GH_CMD = { error: 'error', warning: 'warning', info: 'notice' };
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
function toGitHub(findings) {
    return findings.map((f) => `::${GH_CMD[f.severity]} file=${escProp(f.file)},line=${f.line},col=${f.column},title=${escProp(f.ruleId + ' ' + rules_1.RULES[f.ruleId].name)}::${esc(f.message + ' See ' + f.docs)}`).join('\n');
}
function exitCode(findings, failOn) {
    if (failOn === 'none')
        return 0;
    const t = rules_1.SEVERITY_RANK[failOn];
    if (!t)
        throw new Error(`invalid fail-on: ${failOn} (use error|warning|info|none)`);
    return findings.some((f) => rules_1.SEVERITY_RANK[f.severity] >= t) ? 1 : 0;
}
