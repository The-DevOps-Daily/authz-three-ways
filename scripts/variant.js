// Re-run the step 4 list benchmark with one deliberate change to the code,
// to see what that change is worth. The changed tree must still pass the
// expected-decisions table before anything is timed.
//   node scripts/variant.js cerbos-in-subquery
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

const VARIANTS = {
  // The committed adapter turns "user in viewers" into a correlated EXISTS,
  // which SQLite runs once per document. An uncorrelated IN subquery runs once.
  'cerbos-in-subquery': {
    file: 'approaches/cerbos/plan-to-sql.js',
    edits: [
      [
        `"EXISTS (SELECT 1 FROM shares s WHERE s.document_id = d.id AND s.level = 'view' AND s.user_id = ?)"`,
        `"d.id IN (SELECT s.document_id FROM shares s WHERE s.level = 'view' AND s.user_id = ?)"`,
      ],
      [
        `"EXISTS (SELECT 1 FROM shares s WHERE s.document_id = d.id AND s.level = 'edit' AND s.user_id = ?)"`,
        `"d.id IN (SELECT s.document_id FROM shares s WHERE s.level = 'edit' AND s.user_id = ?)"`,
      ],
    ],
    only: 'ifs,cerbos',
  },
};

const name = process.argv[2];
const v = VARIANTS[name];
if (!v) throw new Error(`usage: node scripts/variant.js <${Object.keys(VARIANTS).join('|')}>`);
const tree = `${root}.steps/variant-${name}`;
rmSync(tree, { recursive: true, force: true });
mkdirSync(tree, { recursive: true });
execFileSync('tar', ['-x', '-C', tree], {
  input: execFileSync('git', ['-C', root, 'archive', 'step4-spicedb', 'app', 'approaches']),
});
const path = `${tree}/${v.file}`;
let src = readFileSync(path, 'utf8');
for (const [from, to] of v.edits) {
  if (src.split(from).length !== 2) throw new Error(`${name}: text to replace not found exactly once in ${v.file}`);
  src = src.replace(from, to);
}
writeFileSync(path, src);

const run = (args) => execFileSync('node', args, { cwd: root, stdio: 'inherit' });
run(['harness/correctness.js', '--step=4', `--tree=${tree}`, `--only=${v.only}`]);
mkdirSync(`${root}results/final`, { recursive: true });
run([
  'harness/bench-list.js',
  '--step=4',
  `--tree=${tree}`,
  '--docs=10000',
  '--iters=20',
  '--warmup=3',
  `--only=${v.only}`,
  `--out=results/final/variant-${name}.json`,
]);
rmSync(tree, { recursive: true, force: true });
