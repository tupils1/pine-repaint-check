import { run } from './run';

const input = (n: string, d: string) => (process.env[`INPUT_${n.replace(/ /g, '_').toUpperCase()}`] ?? '').trim() || d;

try {
  const paths = input('paths', '.').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const code = run({
    paths, format: 'github', failOn: input('fail-on', 'error'), minSeverity: input('min-severity', 'info') as 'info',
    sarifOutput: input('sarif-output', '') || undefined, disable: input('disable', '').split(',').map((s) => s.trim()).filter(Boolean),
  }, (s) => process.stdout.write(s));
  process.exitCode = code;
} catch (e) {
  process.stdout.write(`::error::pine-repaint-check: ${(e as Error).message}\n`);
  process.exitCode = 2;
}
