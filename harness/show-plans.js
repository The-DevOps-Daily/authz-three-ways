// Print the Cerbos query plan for "view" for every fixture user, and the SQL
// our adapter makes of it, at one step. Shows what the adapter has to handle.
//   node harness/show-plans.js --step=4 --tree=.steps/step4 --out=file
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { GRPC } from '@cerbos/grpc';
import { args, stamp, writeJson } from './lib.js';
import { fixtureWorld } from './world.js';
import { startServers } from './servers.js';

const a = args({ tree: '.' });
const step = Number(a.step);
const world = fixtureWorld();
const { planToSql } = await import(pathToFileURL(join(resolve(a.tree), 'approaches/cerbos/plan-to-sql.js')).href);
const stop = await startServers(a.tree, ['cerbos']);
const out = { stamp: stamp(a.tree, { step }), plans: {} };
try {
  const cerbos = new GRPC('127.0.0.1:3593', { tls: false });
  for (const u of world.users) {
    // The same principal the cerbos approach builds at step 4.
    const principal = { id: u.id, roles: [u.role], attr: { teams: u.teams, contractor: u.contractor } };
    const plan = await cerbos.planResources({ principal, resource: { kind: 'document' }, action: 'view' });
    const entry = { kind: plan.kind };
    if (plan.condition) {
      const params = [];
      entry.condition = JSON.parse(JSON.stringify(plan.condition));
      entry.sql = planToSql(plan.condition, params);
      entry.params = params;
    }
    out.plans[u.id] = entry;
    console.log(`${u.id.padEnd(5)} ${plan.kind}${entry.sql ? `\n      WHERE ${entry.sql}  ${JSON.stringify(entry.params)}` : ''}`);
  }
  cerbos.close();
} finally {
  await stop();
}
if (a.out) writeJson(a.out, out);
