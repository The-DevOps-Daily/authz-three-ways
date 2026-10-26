// Shared helpers for the harness: seeded RNG, percentiles, run stamps, CLI args.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, loadavg, totalmem, release, arch } from 'node:os';
import { dirname, join, relative } from 'node:path';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// Nearest-rank percentile on a sorted copy.
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(samplesMs) {
  const s = [...samplesMs].sort((a, b) => a - b);
  const mean = s.reduce((x, y) => x + y, 0) / s.length;
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    n: s.length,
    min: r(s[0]),
    p50: r(percentile(s, 50)),
    p95: r(percentile(s, 95)),
    p99: r(percentile(s, 99)),
    p999: r(percentile(s, 99.9)),
    max: r(s[s.length - 1]),
    mean: r(mean),
  };
}

export function args(defaults = {}) {
  const out = { ...defaults };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

function hashTree(root, dirs) {
  const h = createHash('sha256');
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(relative(root, p) + '\0').update(readFileSync(p));
    }
  };
  for (const d of dirs) walk(join(root, d));
  return h.digest('hex').slice(0, 16);
}

// Every result file carries this, so a number can be traced to the code that produced it.
export function stamp(tree, extra = {}) {
  const sh = (c) => {
    try {
      return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const root = new URL('..', import.meta.url).pathname;
  return {
    startedAt: new Date().toISOString(),
    harnessCommit: sh(`git -C ${root} rev-parse --short HEAD`),
    harnessDirty: sh(`git -C ${root} status --porcelain -- harness`) !== '',
    treeHash: hashTree(tree, ['app', 'approaches']),
    harnessHash: hashTree(root, ['harness']),
    node: process.version,
    cerbos: sh(`${root}.bin/cerbos --version`),
    spicedb: sh(`${root}.bin/spicedb version`),
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memGiB: Math.round(totalmem() / 2 ** 30 * 10) / 10,
    kernel: release(),
    arch: arch(),
    loadavgAtStart: loadavg().map((x) => Math.round(x * 100) / 100),
    ...extra,
  };
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export const now = () => Number(process.hrtime.bigint()) / 1e6;
