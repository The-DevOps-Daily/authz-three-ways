// Lines and files changed per step per approach, read from git. Each approach
// has one commit per step, tagged step<N>-<approach>; the shared data-model
// change has its own commit, tagged step<N>-data.
//   node scripts/diffstat.js > results/diffstat.txt   (also writes results/diffstat.json)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
const NAMES = ['ifs', 'cerbos', 'spicedb'];

function kind(path) {
  if (/\.(ya?ml|zed)$/.test(path)) return 'policy';
  return 'code';
}

function numstat(tag, path) {
  const out = git('diff', '--numstat', `${tag}^`, tag, '--', path).trim();
  const files = out
    ? out.split('\n').map((l) => {
        const [add, del, file] = l.split('\t');
        return { file, added: Number(add), deleted: Number(del), kind: kind(file) };
      })
    : [];
  const sum = (k, f = () => true) => files.filter(f).reduce((s, x) => s + x[k], 0);
  return {
    commit: git('rev-parse', '--short', tag).trim(),
    files: files.length,
    added: sum('added'),
    deleted: sum('deleted'),
    changed: sum('added') + sum('deleted'),
    policyLines: sum('added', (x) => x.kind === 'policy') + sum('deleted', (x) => x.kind === 'policy'),
    codeLines: sum('added', (x) => x.kind === 'code') + sum('deleted', (x) => x.kind === 'code'),
    detail: files,
  };
}

// Non-blank, non-comment lines at a tag, per approach.
function size(tag, name) {
  const files = git('ls-tree', '-r', '--name-only', tag, `approaches/${name}`).trim().split('\n');
  let lines = 0;
  for (const f of files) {
    for (const l of git('show', `${tag}:${f}`).split('\n')) {
      const t = l.trim();
      if (t && !t.startsWith('//') && !t.startsWith('#')) lines++;
    }
  }
  return { files: files.length, lines };
}

const result = { steps: {} };
for (let step = 1; step <= 4; step++) {
  const s = { data: numstat(`step${step}-data`, 'app') };
  for (const n of NAMES) s[n] = { ...numstat(`step${step}-${n}`, `approaches/${n}`), sizeAfter: size(`step${step}-${n}`, n) };
  result.steps[step] = s;
}
writeFileSync(`${root}results/diffstat.json`, JSON.stringify(result, null, 2) + '\n');

const pad = (v, w) => String(v).padStart(w);
console.log('step  approach  files  +added  -deleted  changed  (policy/schema, app code)  size after step');
for (const [step, s] of Object.entries(result.steps)) {
  for (const n of ['data', ...NAMES]) {
    const x = s[n];
    const sizeTxt = x.sizeAfter ? `${x.sizeAfter.lines} lines in ${x.sizeAfter.files} files` : '';
    console.log(
      `${pad(step, 4)}  ${n.padEnd(8)}  ${pad(x.files, 5)}  ${pad('+' + x.added, 6)}  ${pad('-' + x.deleted, 8)}  ${pad(x.changed, 7)}  (${x.policyLines}, ${x.codeLines})${' '.repeat(18)}${sizeTxt}`,
    );
  }
  for (const n of ['data', ...NAMES]) {
    for (const f of s[n].detail) console.log(`        ${n.padEnd(8)} ${f.file}  +${f.added} -${f.deleted}`);
  }
}
