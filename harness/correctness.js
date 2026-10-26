// Run fixture/expected.csv against each approach at one step.
// Every (user, action, document) row must match, and list(user) must return
// exactly the documents the table says the user can view.
//   node harness/correctness.js --step=3 [--tree=.] [--only=ifs,cerbos] [--out=file]
import { args, stamp, writeJson } from './lib.js';
import { fixtureWorld, expectedRows } from './world.js';
import { loadApp, openApproaches, namesFrom } from './approaches.js';
import { startServers } from './servers.js';

const a = args({ tree: '.' });
const step = Number(a.step);
if (!(step >= 1 && step <= 4)) throw new Error('--step=1..4 is required');
const names = namesFrom(a.only);
const col = `step${step}`;

const world = fixtureWorld();
const rows = expectedRows();
const { createDb } = await loadApp(a.tree);
const db = createDb(world);
const stop = await startServers(a.tree, names);

const result = { stamp: stamp(a.tree, { step, approaches: names }), approaches: {} };
let failed = 0;
try {
  const impls = await openApproaches(a.tree, db, names);
  for (const name of names) {
    const impl = impls[name];
    const mismatches = [];
    for (const r of rows) {
      let got;
      try {
        got = (await impl.check(r.user, r.action, r.document)) ? 'allow' : 'deny';
      } catch (e) {
        got = `error: ${e.message}`;
      }
      if (got !== r[col]) mismatches.push({ kind: 'check', ...r, expected: r[col], got });
    }
    for (const u of world.users) {
      const want = rows
        .filter((r) => r.user === u.id && r.action === 'view' && r[col] === 'allow')
        .map((r) => r.document)
        .sort();
      let got;
      try {
        got = [...(await impl.list(u.id))].sort();
      } catch (e) {
        got = [`error: ${e.message}`];
      }
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        mismatches.push({ kind: 'list', user: u.id, expected: want, got });
      }
    }
    await impl.close?.();
    failed += mismatches.length;
    result.approaches[name] = {
      checks: rows.length,
      lists: world.users.length,
      mismatches: mismatches.length,
      details: mismatches,
    };
    console.log(
      `step ${step} ${name.padEnd(8)} ${rows.length} checks + ${world.users.length} lists: ` +
        (mismatches.length ? `${mismatches.length} MISMATCHES` : 'all match'),
    );
    for (const m of mismatches.slice(0, 10)) console.log('   ', JSON.stringify(m));
  }
} finally {
  await stop();
}
if (a.out) writeJson(a.out, result);
process.exit(failed ? 1 : 0);
