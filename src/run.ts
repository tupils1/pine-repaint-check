import * as fs from 'fs';
import { analyze, Finding } from './analyze';
import { collect } from './files';
import { exitCode, toGitHub, toJSON, toSARIF, toText } from './format';
import { SEVERITY_RANK, Severity } from './rules';

export interface Options {
  paths: string[];
  format: 'text' | 'json' | 'sarif' | 'github';
  failOn: string;
  minSeverity: Severity;
  sarifOutput?: string;
  disable: string[];
}

export function run(o: Options, write: (s: string) => void): number {
  const files = collect(o.paths.length ? o.paths : ['.']);
  let findings: Finding[] = [];
  for (const f of files) findings.push(...analyze(fs.readFileSync(f, 'utf8'), f));
  findings = findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[o.minSeverity] && !o.disable.includes(f.ruleId));
  if (o.sarifOutput) fs.writeFileSync(o.sarifOutput, toSARIF(findings));
  const body = o.format === 'json' ? toJSON(findings, files.length) : o.format === 'sarif' ? toSARIF(findings) : o.format === 'github' ? toGitHub(findings) + '\n' + toText(findings, files.length) : toText(findings, files.length);
  write(body + '\n');
  return exitCode(findings, o.failOn);
}
