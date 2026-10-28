import * as fs from 'fs';
import * as path from 'path';

const EXT = /\.(pine|pinescript)$/i;
const SKIP = new Set(['node_modules', '.git', 'dist']);

export function collect(inputs: string[], exts = EXT): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p).sort()) if (!SKIP.has(e)) walk(path.join(p, e));
    } else if (exts.test(p)) out.push(p);
  };
  for (const i of inputs) {
    if (!fs.existsSync(i)) throw new Error(`path not found: ${i}`);
    const st = fs.statSync(i);
    if (st.isFile()) out.push(i); else walk(i);
  }
  return [...new Set(out)];
}
