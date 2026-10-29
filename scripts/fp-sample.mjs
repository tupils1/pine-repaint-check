#!/usr/bin/env node
// Reproducible false-positive sample of public .pine files that contain `lookahead_on`.
//
// Population: GitHub code search `lookahead_on extension:pine` (forks excluded by default).
// The search API returns at most 1000 hits per query, so enumerate() partitions on file
// size until every partition has <= 1000 hits, then pages through it.
//
// Sample: sort the frame by repo+path, then Fisher-Yates with mulberry32(seed).
// Only MIT / Apache-2.0 / MPL-2.0 / BSD-2-Clause / BSD-3-Clause sources are written
// under corpus/fp-eval/files/. Everything else is recorded by URL in the manifest.
//
// Usage:
//   node scripts/fp-sample.mjs enumerate     # needs `gh` auth; resumable
//   node scripts/fp-sample.mjs sample        # writes corpus/fp-eval/sample.json
//   node scripts/fp-sample.mjs fetch         # license check + raw download
//   node scripts/fp-sample.mjs scan          # run every rule on the pinned sample
//   node scripts/fp-sample.mjs report        # precision + Wilson 95% CI from labels
//   node scripts/fp-sample.mjs selftest
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'corpus', 'fp-eval');
const CACHE = process.env.FP_CACHE || '/tmp/fp-eval-cache';
const SEED = 20261028;
const SAMPLE_N = 200;
const QUERY = 'lookahead_on extension:pine';
const SEARCH_GAP_MS = Number(process.env.FP_SEARCH_GAP_MS || 25000);

export const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'MPL-2.0', 'BSD-2-Clause', 'BSD-3-Clause']);

const SIZE_RANGES = [
  [0, 300], [301, 600], [601, 1000], [1001, 1500], [1501, 2200], [2201, 3200],
  [3201, 4500], [4501, 6500], [6501, 9000], [9001, 13000], [13001, 20000],
  [20001, 35000], [35001, 60000], [60001, 120000], [120001, 500000], [500001, 5000000],
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fisherYatesSample(items, n, seed) {
  const arr = items.slice().sort((a, b) => (a.repo + '\0' + a.path).localeCompare(b.repo + '\0' + b.path));
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n).sort((a, b) => (a.repo + '\0' + a.path).localeCompare(b.repo + '\0' + b.path));
}

/** Wilson score interval for a binomial proportion. z ≈ 1.96 for 95%. */
export function wilson(successes, n, z = 1.959963984540054) {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

const COPYLEFT_RE = /\b(GPL-|AGPL-|LGPL-|GNU General Public|GNU Affero|GNU Lesser|CC-BY-NC|CC-BY-SA|Commons Attribution-NonCommercial|All rights reserved\.?\s*This (program|software|source) is not free)\b/i;

export function fileLicenseSignals(text) {
  const head = text.split(/\r?\n/).slice(0, 80).join('\n');
  const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/.exec(head);
  let fileSpdx = spdx ? spdx[1] : null;
  if (!fileSpdx && /Mozilla Public License 2\.0/i.test(head)) fileSpdx = 'MPL-2.0';
  if (!fileSpdx && /Apache License,? Version 2\.0/i.test(head)) fileSpdx = 'Apache-2.0';
  if (!fileSpdx && (/MIT License/i.test(head) || /Permission is hereby granted, free of charge/i.test(head))) fileSpdx = 'MIT';
  if (!fileSpdx && /SPDX-License-Identifier:\s*BSD-3-Clause/i.test(head)) fileSpdx = 'BSD-3-Clause';
  if (!fileSpdx && /SPDX-License-Identifier:\s*BSD-2-Clause/i.test(head)) fileSpdx = 'BSD-2-Clause';
  if (!fileSpdx && /Redistribution and use in source and binary forms[\s\S]{0,400}Neither the name/i.test(head)) fileSpdx = 'BSD-3-Clause';
  if (!fileSpdx && /Redistribution and use in source and binary forms/i.test(head) && /BSD-2-Clause|2-Clause BSD/i.test(head)) fileSpdx = 'BSD-2-Clause';
  const copyleft = COPYLEFT_RE.test(head) && !(fileSpdx && PERMISSIVE.has(fileSpdx));
  return { fileSpdx, copyleft };
}

/**
 * Store the source only when the file is clearly MIT, Apache-2.0, MPL-2.0,
 * BSD-2-Clause, or BSD-3-Clause. A copyleft repo license conflicts with a
 * permissive header (the file is not stored). Missing license → URL only.
 */
export function licenseDecision(repoSpdx, signals) {
  const repo = !repoSpdx || repoSpdx === 'NOASSERTION' ? null : repoSpdx;
  const file = signals.fileSpdx && PERMISSIVE.has(signals.fileSpdx) ? signals.fileSpdx : null;
  const repoOk = !!(repo && PERMISSIVE.has(repo));
  if (signals.copyleft && !file) {
    return { store: false, spdx: repo, reason: 'copyleft-or-nonpermissive-header' };
  }
  if (repo && !PERMISSIVE.has(repo)) {
    return { store: false, spdx: repo, reason: file ? 'repo-license-conflicts-with-header' : 'repo-license-not-permissive' };
  }
  if (file && repoOk && file !== repo) {
    return { store: true, spdx: file, reason: `file-${file}-repo-${repo}` };
  }
  if (file) return { store: true, spdx: file, reason: repoOk ? `repo-and-file-${file}` : `file-header-${file}` };
  if (repoOk && !signals.copyleft) return { store: true, spdx: repo, reason: `repo-${repo}` };
  return { store: false, spdx: repo, reason: 'license-unknown' };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ghApi(apiPath, { raw = false } = {}) {
  const args = ['api'];
  if (raw) args.push('-H', 'Accept: application/vnd.github.raw');
  args.push(apiPath);
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 45000 });
  const err = r.error ? `gh: ${r.error.message}` : '';
  return { ok: r.status === 0 && !r.error, stdout: r.stdout || '', stderr: err || r.stderr || '' };
}

const log = (msg) => process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
const nextAllowedPath = () => path.join(CACHE, 'next-allowed');

function nextAllowedAt() {
  try { return Number(fs.readFileSync(nextAllowedPath(), 'utf8')) || 0; } catch { return 0; }
}
function setNextAllowed(epochMs) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(nextAllowedPath(), String(epochMs));
}

/**
 * Code search's primary quota is 10/min, but a secondary 429 escalates to ~12 minutes
 * if several retries land close together. A single retry inside the short Retry-After
 * often succeeds; a second miss should wait out a full cooldown instead of poking.
 */
async function ghSearch(apiPath) {
  let quickRetries = 0;
  for (let attempt = 1; attempt <= 40; attempt++) {
    const waitFor = nextAllowedAt() - Date.now();
    if (waitFor > 0) {
      log(`waiting ${Math.ceil(waitFor / 1000)}s for code-search pacing`);
      await sleep(waitFor);
    }
    const r = ghApi(apiPath);
    if (r.ok) {
      quickRetries = 0;
      setNextAllowed(Date.now() + SEARCH_GAP_MS);
      try { return JSON.parse(r.stdout); }
      catch (e) { throw new Error(`bad json from ${apiPath}: ${e.message}\n${r.stdout.slice(0, 200)}`); }
    }
    const first = (r.stderr.trim().split('\n').find((l) => l.startsWith('gh:')) || r.stderr.trim().split('\n')[0] || '');
    const wait = /try again in ([0-9.]+)\s*(ms|s)\b/i.exec(first);
    const hinted = !wait ? 30 : (wait[2].toLowerCase() === 'ms' ? 1 : Math.ceil(Number(wait[1])));
    let sec;
    if (hinted > 90) {
      quickRetries = 0;
      sec = hinted + 15;
    } else if (quickRetries >= 1) {
      quickRetries = 0;
      sec = 12 * 60;
    } else {
      quickRetries++;
      sec = Math.max(3, hinted + 2);
    }
    setNextAllowed(Date.now() + sec * 1000);
    log(`search backoff ${attempt} for ${sec}s: ${first.slice(0, 160)}`);
    await sleep(sec * 1000);
  }
  throw new Error(`gh api failed: ${apiPath}`);
}

function loadJson(p, fallback) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
}
function saveJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

function slimItem(item) {
  const html = item.html_url || '';
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(html);
  if (!m) return null;
  return {
    repo: item.repository?.full_name || `${m[1]}/${m[2]}`,
    path: item.path,
    ref: m[3],
    blobSha: item.sha,
    htmlUrl: html,
  };
}

async function searchRange(lo, hi, page) {
  const q = `${QUERY} size:${lo}..${hi}`;
  const url = 'search/code?q=' + encodeURIComponent(q) + `&per_page=100&page=${page}`;
  const data = await ghSearch(url);
  if (data.incomplete_results) {
    log(`incomplete results ${lo}..${hi} page ${page}, retrying once`);
    return ghSearch(url);
  }
  return data;
}

async function enumerate() {
  const notBefore = Number(process.env.FP_NOT_BEFORE || 0);
  const hold = notBefore * 1000 - Date.now();
  if (hold > 0) {
    log(`cooldown ${Math.ceil(hold / 1000)}s before the next code search`);
    await sleep(hold);
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const statePath = path.join(CACHE, 'enumerate-state.json');
  const state = loadJson(statePath, { done: {}, queue: SIZE_RANGES.map(([lo, hi]) => [lo, hi]), partial: {} });
  state.partial ||= {};
  while (state.queue.length) {
    const [lo, hi] = state.queue[0];
    const key = `${lo}..${hi}`;
    if (state.done[key]) { state.queue.shift(); saveJson(statePath, state); continue; }
    let total;
    let items;
    let nextPage;
    const partial = state.partial[key];
    if (partial) {
      total = partial.total;
      items = partial.items;
      nextPage = partial.nextPage;
      log(`resume ${key} total=${total} from page ${nextPage}`);
    } else {
      const first = await searchRange(lo, hi, 1);
      total = first.total_count || 0;
      log(`range ${key} total=${total}`);
      // Exactly 1000 is ambiguous: the API also stops paging at 1000.
      if (total >= 1000) {
        if (hi <= lo) throw new Error(`unsplittable range ${key} has ${total}`);
        const mid = Math.floor((lo + hi) / 2);
        state.queue[0] = [lo, mid];
        state.queue.splice(1, 0, [mid + 1, hi]);
        saveJson(statePath, state);
        continue;
      }
      items = [];
      for (const it of first.items || []) {
        const s = slimItem(it);
        if (s) items.push(s);
      }
      nextPage = 2;
      state.partial[key] = { total, items, nextPage };
      saveJson(statePath, state);
    }
    const pages = Math.max(1, Math.ceil(total / 100));
    for (let page = nextPage; page <= pages; page++) {
      const data = await searchRange(lo, hi, page);
      for (const it of data.items || []) {
        const s = slimItem(it);
        if (s) items.push(s);
      }
      state.partial[key] = { total, items, nextPage: page + 1 };
      saveJson(statePath, state);
      log(`  page ${page}/${pages} (+${(data.items || []).length})`);
    }
    state.done[key] = { total, items };
    delete state.partial[key];
    state.queue.shift();
    saveJson(statePath, state);
  }
  const byKey = new Map();
  for (const bucket of Object.values(state.done)) {
    for (const it of bucket.items) byKey.set(`${it.repo}\0${it.path}`, it);
  }
  const population = [...byKey.values()].sort((a, b) => (a.repo + '\0' + a.path).localeCompare(b.repo + '\0' + b.path));
  const declared = Object.values(state.done).reduce((s, b) => s + b.total, 0);
  const meta = {
    query: QUERY,
    retrievedAt: new Date().toISOString(),
    seedNote: 'population frozen from GitHub code search; re-running enumerate later can differ',
    partitions: Object.fromEntries(Object.entries(state.done).map(([k, v]) => [k, v.total])),
    declaredTotal: declared,
    uniqueFiles: population.length,
  };
  saveJson(path.join(OUT, 'population.json'), { meta, files: population });
  log(`unique ${population.length} declared ${declared}`);
}

function sample() {
  const pop = loadJson(path.join(OUT, 'population.json'));
  if (!pop?.files?.length) throw new Error('missing population.json; run enumerate');
  const chosen = fisherYatesSample(pop.files, SAMPLE_N, SEED);
  saveJson(path.join(OUT, 'sample.json'), {
    seed: SEED,
    n: SAMPLE_N,
    algorithm: 'sort by repo+NUL+path, Fisher-Yates, mulberry32(seed), keep first n, re-sort',
    frameUnique: pop.files.length,
    frameDeclared: pop.meta.declaredTotal,
    retrievedAt: pop.meta.retrievedAt,
    query: pop.meta.query,
    files: chosen.map((f, i) => ({ id: `s${String(i).padStart(4, '0')}`, ...f })),
  });
  process.stderr.write(`sampled ${chosen.length}\n`);
}

async function repoLicense(repo) {
  const cacheFile = path.join(CACHE, 'repo-license.json');
  const cache = loadJson(cacheFile, {});
  if (repo in cache) return cache[repo];
  const r = ghApi(`repos/${repo}`);
  let spdx = null;
  let licenseUrl = null;
  if (r.ok) {
    const data = JSON.parse(r.stdout);
    spdx = data.license?.spdx_id || null;
    licenseUrl = data.license?.url || null;
  } else if (!/HTTP 404|HTTP 451|HTTP 403/.test(r.stderr)) {
    const wait = /try again in ([0-9.]+)s/i.exec(r.stderr);
    await sleep(((wait ? Math.ceil(Number(wait[1])) : 10) + 1) * 1000);
    return repoLicense(repo);
  }
  cache[repo] = { spdx, licenseUrl };
  saveJson(cacheFile, cache);
  return cache[repo];
}

async function fetchBlob(entry) {
  const apiPath = `repos/${entry.repo}/git/blobs/${entry.blobSha}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = ghApi(apiPath);
    if (r.ok) {
      const data = JSON.parse(r.stdout);
      if (data.encoding === 'base64') return Buffer.from(data.content, 'base64');
      throw new Error(`unexpected blob encoding for ${entry.htmlUrl}`);
    }
    const wait = /try again in ([0-9.]+)s/i.exec(r.stderr);
    await sleep(((wait ? Math.ceil(Number(wait[1])) : 5 * attempt) + 1) * 1000);
  }
  throw new Error(`blob fetch failed ${entry.htmlUrl}`);
}

function safeName(id, entry) {
  const base = path.basename(entry.path).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  const repo = entry.repo.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
  return `${id}_${repo}_${base}`.replace(/\.pine$/i, '') + '.pine';
}

function loadAnalyzer() {
  return require(path.join(ROOT, 'dist', 'index.js'));
}

function scan() {
  const sampleDoc = loadJson(path.join(OUT, 'sample.json'));
  const manifest = loadJson(path.join(OUT, 'manifest.json'));
  const { analyze } = loadAnalyzer();
  const cacheDir = path.join(CACHE, 'src');
  fs.mkdirSync(cacheDir, { recursive: true });
  const findings = [];
  for (const entry of sampleDoc.files) {
    const row = manifest.files[entry.id];
    if (!row?.fetched) throw new Error(`not fetched: ${entry.id}`);
    let text;
    if (row.storedAs) text = fs.readFileSync(path.join(OUT, row.storedAs), 'utf8');
    else {
      const cached = path.join(cacheDir, entry.blobSha);
      if (!fs.existsSync(cached)) throw new Error(`missing cached source for ${entry.id} (${entry.htmlUrl}). Re-run fetch; non-permissive sources are not in git.`);
      text = fs.readFileSync(cached, 'utf8');
    }
    const file = row.storedAs || entry.htmlUrl;
    for (const f of analyze(text, file)) {
      findings.push({
        id: `${entry.id}:${f.ruleId}:${f.line}:${f.column}`,
        sampleId: entry.id,
        ruleId: f.ruleId,
        severity: f.severity,
        line: f.line,
        column: f.column,
        message: f.message,
        htmlUrl: entry.htmlUrl,
        stored: !!row.storedAs,
      });
    }
  }
  saveJson(path.join(OUT, 'findings.json'), {
    generatedAt: new Date().toISOString(),
    filesScanned: sampleDoc.files.length,
    findingCount: findings.length,
    findings,
  });
  process.stderr.write(`findings ${findings.length}\n`);
}

async function fetchSampleKeepingCache() {
  // wrap fetchBlob results into the non-committed cache as well
  const sampleDoc = loadJson(path.join(OUT, 'sample.json'));
  const manifestPath = path.join(OUT, 'manifest.json');
  const prev = loadJson(manifestPath, { files: {} });
  const filesDir = path.join(OUT, 'files');
  const cacheDir = path.join(CACHE, 'src');
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  let i = 0;
  for (const entry of sampleDoc.files) {
    i++;
    if (prev.files[entry.id]?.fetched && fs.existsSync(path.join(cacheDir, entry.blobSha))) {
      process.stderr.write(`[${i}/${sampleDoc.files.length}] skip ${entry.id}\n`);
      continue;
    }
    process.stderr.write(`[${i}/${sampleDoc.files.length}] ${entry.repo} ${entry.path}\n`);
    const buf = await fetchBlob(entry);
    fs.writeFileSync(path.join(cacheDir, entry.blobSha), buf);
    const text = buf.toString('utf8');
    const signals = fileLicenseSignals(text);
    const repo = await repoLicense(entry.repo);
    const decision = licenseDecision(repo.spdx, signals);
    const row = {
      ...entry,
      fetched: true,
      bytes: buf.length,
      repoSpdx: repo.spdx,
      fileSpdx: signals.fileSpdx,
      fileCopyleft: signals.copyleft,
      store: decision.store,
      license: decision.spdx,
      reason: decision.reason,
      storedAs: null,
    };
    if (decision.store && !buf.includes(0)) {
      const name = safeName(entry.id, entry);
      fs.writeFileSync(path.join(filesDir, name), buf);
      row.storedAs = `files/${name}`;
    } else if (decision.store && buf.includes(0)) {
      row.store = false;
      row.reason = 'binary-skipped';
    }
    prev.files[entry.id] = row;
    prev.updatedAt = new Date().toISOString();
    saveJson(manifestPath, prev);
    await sleep(120);
  }
  const rows = Object.values(prev.files);
  const stored = rows.filter((r) => r.storedAs).length;
  process.stderr.write(`stored ${stored} / ${rows.length}\n`);
}

function pct(x) { return x == null ? 'n/a' : `${(100 * x).toFixed(1)}%`; }

function report() {
  const judged = path.join(OUT, 'findings-judged.json');
  const findingsDoc = loadJson(fs.existsSync(judged) ? judged : path.join(OUT, 'findings.json'));
  const labels = loadJson(path.join(OUT, 'labels.json'));
  const { RULES } = loadAnalyzer();
  const byRule = {};
  for (const id of Object.keys(RULES)) byRule[id] = { tp: 0, fp: 0, unlabeled: 0 };
  const missing = [];
  for (const f of findingsDoc.findings) {
    const lab = labels.items?.[f.id];
    if (!lab) { byRule[f.ruleId].unlabeled++; missing.push(f.id); continue; }
    if (lab.verdict === 'tp') byRule[f.ruleId].tp++;
    else if (lab.verdict === 'fp') byRule[f.ruleId].fp++;
    else missing.push(f.id + ' bad verdict');
  }
  const rows = [];
  for (const [id, v] of Object.entries(byRule)) {
    const n = v.tp + v.fp;
    const prec = wilson(v.tp, n);
    const fpr = wilson(v.fp, n);
    rows.push({ id, name: RULES[id].name, ...v, n, prec, fpr });
  }
  const ci = (w) => w ? `${pct(w.low)}–${pct(w.high)}` : 'n/a';
  const lines = [];
  lines.push('| rule | hits | TP | FP | precision | 95% CI | FP rate | 95% CI |');
  lines.push('|---|---:|---:|---:|---:|---|---:|---|');
  for (const r of rows) {
    lines.push(`| ${r.id} ${r.name} | ${r.n} | ${r.tp} | ${r.fp} | ${pct(r.prec?.p)} | ${ci(r.prec)} | ${pct(r.fpr?.p)} | ${ci(r.fpr)} |`);
  }
  const split = { islast: { tp: 0, fp: 0 }, other: { tp: 0, fp: 0 } };
  for (const f of findingsDoc.findings) {
    if (f.ruleId !== 'PRC006') continue;
    const lab = labels.items?.[f.id];
    if (!lab || (lab.verdict !== 'tp' && lab.verdict !== 'fp')) continue;
    const bucket = /barstate\.islast\b/.test(f.message) && !/islastconfirmedhistory/.test(f.message) ? 'islast' : 'other';
    split[bucket][lab.verdict]++;
  }
  lines.push('', 'PRC006 split. `barstate.islast` findings are info and are omitted when `min-severity` is `warning` (the Action default). `isnew` / `isrealtime` / `ishistory` / `islastconfirmedhistory` stay at PRC006\'s severity (info).', '');
  lines.push('| PRC006 builtin | hits | TP | FP | precision | 95% CI | FP rate | 95% CI |');
  lines.push('|---|---:|---:|---:|---:|---|---:|---|');
  for (const [name, v] of Object.entries(split)) {
    const n = v.tp + v.fp;
    const prec = wilson(v.tp, n);
    const fpr = wilson(v.fp, n);
    lines.push(`| ${name} | ${n} | ${v.tp} | ${v.fp} | ${pct(prec?.p)} | ${ci(prec)} | ${pct(fpr?.p)} | ${ci(fpr)} |`);
  }
  const md = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'precision-table.md'), md);
  if (missing.length) {
    process.stderr.write(`UNLABELED ${missing.length}\n`);
    fs.writeFileSync(path.join(CACHE, 'unlabeled.txt'), missing.join('\n') + '\n');
    process.exitCode = 2;
  }
  process.stdout.write(md);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'enumerate') await enumerate();
  else if (cmd === 'sample') sample();
  else if (cmd === 'fetch') await fetchSampleKeepingCache();
  else if (cmd === 'scan') scan();
  else if (cmd === 'report') report();
  else if (cmd === 'selftest') process.exit(selftest() ? 0 : 1);
  else {
    process.stderr.write('usage: fp-sample.mjs enumerate|sample|fetch|scan|report|selftest\n');
    process.exit(2);
  }
}

export function selftest() {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  assert(PERMISSIVE.has('MIT') && PERMISSIVE.has('BSD-3-Clause'));
  const items = Array.from({ length: 50 }, (_, i) => ({ repo: `o/r${i}`, path: `a/${i}.pine` }));
  const a = fisherYatesSample(items, 10, 20261028);
  const b = fisherYatesSample(items, 10, 20261028);
  assert(JSON.stringify(a) === JSON.stringify(b), 'sample stable');
  assert(a.length === 10, 'sample size');
  assert(new Set(a.map((x) => x.path)).size === 10, 'sample unique');
  const w = wilson(80, 100);
  assert(w.low > 0.7 && w.low < 0.8 && w.high > 0.85 && w.high < 0.9, `wilson ${w.low} ${w.high}`);
  assert(wilson(0, 0) === null);
  const mpl = fileLicenseSignals('// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/\n');
  assert(mpl.fileSpdx === 'MPL-2.0' && !mpl.copyleft, 'mpl header');
  const gpl = fileLicenseSignals('// SPDX-License-Identifier: GPL-3.0\n');
  assert(gpl.copyleft, 'gpl header');
  assert(licenseDecision('MIT', { fileSpdx: null, copyleft: false }).store === true);
  assert(licenseDecision('GPL-3.0', { fileSpdx: 'MIT', copyleft: false }).store === false);
  assert(licenseDecision(null, { fileSpdx: 'MPL-2.0', copyleft: false }).store === true);
  assert(licenseDecision(null, { fileSpdx: null, copyleft: false }).store === false);
  assert(licenseDecision('Apache-2.0', { fileSpdx: 'MPL-2.0', copyleft: false }).spdx === 'MPL-2.0');
  assert(licenseDecision('NOASSERTION', { fileSpdx: null, copyleft: false }).store === false);
  const seq = [];
  const rand = mulberry32(20261028);
  for (let i = 0; i < 32; i++) seq.push(rand());
  assert(seq.every((x) => x >= 0 && x < 1), 'unit interval');
  assert(new Set(seq.map((x) => x.toFixed(8))).size === 32, 'rng period');
  assert(Math.min(...seq) < 0.2 && Math.max(...seq) > 0.8, 'rng spread');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { process.stderr.write(e.stack + '\n'); process.exit(1); });
}
