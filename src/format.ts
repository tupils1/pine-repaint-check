import { Finding, } from './analyze';
import { RULES, SEVERITY_RANK, Severity } from './rules';

export const VERSION = '0.1.0';

export function toText(findings: Finding[], filesScanned: number): string {
  const lines = findings.map((f) => `${f.file}:${f.line}:${f.column}  ${f.severity.padEnd(7)} ${f.ruleId} ${RULES[f.ruleId].name}  ${f.message}`);
  const c = count(findings);
  lines.push('', `${filesScanned} file(s) scanned: ${c.error} error, ${c.warning} warning, ${c.info} info.`);
  return lines.join('\n');
}

export function count(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  findings.forEach((f) => c[f.severity]++);
  return c;
}

export function toJSON(findings: Finding[], filesScanned: number): string {
  return JSON.stringify({ tool: 'pine-repaint-check', version: VERSION, filesScanned, summary: count(findings), findings }, null, 2);
}

const SARIF_LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

export function toSARIF(findings: Finding[]): string {
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'pine-repaint-check', version: VERSION, informationUri: 'https://github.com/tupils1/pine-repaint-check',
        rules: Object.values(RULES).map((r) => ({ id: r.id, name: r.name, shortDescription: { text: r.summary }, helpUri: r.docs, defaultConfiguration: { level: SARIF_LEVEL[r.severity] } })),
      } },
      results: findings.map((f) => ({
        ruleId: f.ruleId, level: SARIF_LEVEL[f.severity], message: { text: f.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.file.replace(/\\/g, '/') }, region: { startLine: f.line, startColumn: f.column } } }],
      })),
    }],
  }, null, 2);
}

const GH_CMD: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'notice' };
const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s: string) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function toGitHub(findings: Finding[]): string {
  return findings.map((f) => `::${GH_CMD[f.severity]} file=${escProp(f.file)},line=${f.line},col=${f.column},title=${escProp(f.ruleId + ' ' + RULES[f.ruleId].name)}::${esc(f.message + ' See ' + f.docs)}`).join('\n');
}

export function exitCode(findings: Finding[], failOn: string): number {
  if (failOn === 'none') return 0;
  const t = SEVERITY_RANK[failOn as Severity];
  if (!t) throw new Error(`invalid fail-on: ${failOn} (use error|warning|info|none)`);
  return findings.some((f) => SEVERITY_RANK[f.severity] >= t) ? 1 : 0;
}
