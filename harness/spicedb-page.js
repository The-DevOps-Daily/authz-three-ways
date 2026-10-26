// AuthZed's docs suggest LookupResources for result sets under roughly 10,000
// resources and, above that, paging candidates from your own database through
// CheckBulkPermissions. This times both for "the first 50 documents this user
// can view, in id order", with the step 4 schema and 10,000 documents.
//   node harness/spicedb-page.js --tree=.steps/step4 --out=file
import { setTimeout as sleep } from 'node:timers/promises';
import { v1 } from '@authzed/authzed-node';
import { args, stamp, summarize, writeJson, now } from './lib.js';
import { generateWorld, listProfiles } from './world.js';
import { loadApp, openApproaches } from './approaches.js';
import { startServers, SPICEDB_KEY } from './servers.js';

const a = args({ tree: '.', docs: '10000', page: '50', batch: '100', iters: '10', warmup: '2' });
const docs = Number(a.docs);
const pageSize = Number(a.page);
const batch = Number(a.batch);
const iters = Number(a.iters);
const warmup = Number(a.warmup);
const world = generateWorld({ docs });
const { createDb } = await loadApp(a.tree);
const db = createDb(world);
const stop = await startServers(a.tree, ['spicedb']);
const out = { stamp: stamp(a.tree, { docs, pageSize, batch, iters, warmup }), profiles: {} };
let problems = 0;
try {
  const { spicedb } = await openApproaches(a.tree, db, ['spicedb']);
  await sleep(6000);
  const api = v1.NewClient(SPICEDB_KEY, '127.0.0.1:50051', v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS).promises;
  const ref = (objectType, objectId) => v1.ObjectReference.create({ objectType, objectId });
  const candidates = db.prepare('SELECT id FROM documents WHERE id > ? ORDER BY id LIMIT ?');

  async function pageByBulkCheck(user) {
    const found = [];
    let after = '';
    let requests = 0;
    let scanned = 0;
    let checkedAt;
    while (found.length < pageSize) {
      const ids = candidates.all(after, batch).map((r) => r.id);
      if (ids.length === 0) break;
      scanned += ids.length;
      const res = await api.checkBulkPermissions(
        v1.CheckBulkPermissionsRequest.create({
          // Every call after the first reads at the same revision, as the docs advise.
          consistency: checkedAt
            ? v1.Consistency.create({ requirement: { oneofKind: 'atExactSnapshot', atExactSnapshot: checkedAt } })
            : undefined,
          items: ids.map((id) =>
            v1.CheckBulkPermissionsRequestItem.create({
              resource: ref('document', id),
              permission: 'view',
              subject: v1.SubjectReference.create({ object: ref('user', user) }),
            }),
          ),
        }),
      );
      requests++;
      checkedAt ??= res.checkedAt;
      for (const p of res.pairs) {
        if (p.response.oneofKind !== 'item') throw new Error(`bulk check error ${JSON.stringify(p.response)}`);
        if (p.response.item.permissionship === v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION) {
          found.push(p.request.resource.objectId);
        }
      }
      after = ids[ids.length - 1];
    }
    return { ids: found.slice(0, pageSize), requests, scanned };
  }

  async function pageByLookup(user) {
    const all = [...(await spicedb.list(user))].sort();
    return { ids: all.slice(0, pageSize), requests: spicedb.lastList.requests, visible: all.length };
  }

  for (const [profile, user] of Object.entries(listProfiles(world))) {
    const viaLookup = await pageByLookup(user);
    const viaBulk = await pageByBulkCheck(user);
    const agree = JSON.stringify(viaLookup.ids) === JSON.stringify(viaBulk.ids);
    if (!agree) problems++;
    const t = { lookup: [], bulk: [] };
    for (let i = 0; i < warmup + iters; i++) {
      for (const [k, fn] of i % 2 ? [['bulk', pageByBulkCheck], ['lookup', pageByLookup]] : [['lookup', pageByLookup], ['bulk', pageByBulkCheck]]) {
        const t0 = now();
        await fn(user);
        if (i >= warmup) t[k].push(now() - t0);
      }
    }
    out.profiles[profile] = {
      user,
      agree,
      lookupAllThenFirst50: { visible: viaLookup.visible, requests: viaLookup.requests, latencyMs: summarize(t.lookup) },
      bulkCheckCandidates: { requests: viaBulk.requests, scanned: viaBulk.scanned, latencyMs: summarize(t.bulk) },
    };
    console.log(
      `${profile.padEnd(10)} agree=${agree}  LookupResources then first ${pageSize}: median ${summarize(t.lookup).p50} ms` +
        `  |  CheckBulkPermissions over ${viaBulk.scanned} candidates in ${viaBulk.requests} calls: median ${summarize(t.bulk).p50} ms`,
    );
  }
  api.close();
  spicedb.close();
} finally {
  await stop();
}
out.problems = problems;
if (a.out) writeJson(a.out, out);
process.exit(problems ? 1 : 0);
