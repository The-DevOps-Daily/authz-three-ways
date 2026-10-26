// SpiceDB caches sub-results per revision. By default it reads at a revision
// quantized to a 5 s window (--datastore-revision-quantization-interval), and
// the in-memory datastore's revisions are wall-clock times, so every 5 s the
// read revision moves and the cache starts cold, even with no writes.
// This times both cases on purpose: the first LookupResources in a new window
// (minimize_latency, just after a 5 s boundary), then the same call again at
// exactly the revision the first one used.
//   node harness/spicedb-list-cache.js --tree=.steps/step4 --out=file
import { setTimeout as sleep } from 'node:timers/promises';
import { v1 } from '@authzed/authzed-node';
import { args, stamp, summarize, writeJson, now } from './lib.js';
import { generateWorld, listProfiles } from './world.js';
import { loadApp, openApproaches } from './approaches.js';
import { startServers, SPICEDB_KEY } from './servers.js';

const a = args({ tree: '.', docs: '10000', pairs: '8' });
const docs = Number(a.docs);
const pairs = Number(a.pairs);
const world = generateWorld({ docs });
const { createDb } = await loadApp(a.tree);
const db = createDb(world);
const stop = await startServers(a.tree, ['spicedb']);
const out = { stamp: stamp(a.tree, { docs, pairs }), profiles: {} };
let problems = 0;
try {
  const { spicedb } = await openApproaches(a.tree, db, ['spicedb']);
  await sleep(6000);
  const api = v1.NewClient(SPICEDB_KEY, '127.0.0.1:50051', v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS).promises;
  const ref = (objectType, objectId) => v1.ObjectReference.create({ objectType, objectId });
  const consistency = (requirement) => v1.Consistency.create({ requirement });

  // Wait until 0.7 s past the next 5 s boundary: past the 10% staleness that
  // SpiceDB may pick by default, so the read lands on a new window.
  async function nextWindow() {
    const ms = Date.now();
    await sleep(5000 - (ms % 5000) + 700);
  }

  async function lookup(user, c) {
    const ids = new Set();
    let at;
    // No limit: one streamed call, so both timings use the same request shape.
    const res = await api.lookupResources(
      v1.LookupResourcesRequest.create({
        resourceObjectType: 'document',
        permission: 'view',
        subject: v1.SubjectReference.create({ object: ref('user', user) }),
        consistency: c,
      }),
    );
    for (const r of res) {
      ids.add(r.resourceObjectId);
      at ??= r.lookedUpAt;
    }
    return { ids, at };
  }

  for (const [profile, user] of Object.entries(listProfiles(world))) {
    const expected = JSON.stringify([...(await spicedb.list(user))].sort());
    const cold = [];
    const warm = [];
    const revisions = [];
    for (let i = 0; i < pairs; i++) {
      await nextWindow();
      let t0 = now();
      const first = await lookup(user, consistency({ oneofKind: 'minimizeLatency', minimizeLatency: true }));
      cold.push(now() - t0);
      revisions.push(first.at.token);
      t0 = now();
      const second = await lookup(user, consistency({ oneofKind: 'atExactSnapshot', atExactSnapshot: first.at }));
      warm.push(now() - t0);
      for (const r of [first, second]) if (JSON.stringify([...r.ids].sort()) !== expected) problems++;
    }
    // Every cold call must have read at a revision no earlier call used.
    if (new Set(revisions).size !== revisions.length) problems++;
    out.profiles[profile] = {
      user,
      visible: JSON.parse(expected).length,
      coldMs: summarize(cold),
      warmMs: summarize(warm),
      coldSamples: cold.map((v) => Math.round(v)),
      warmSamples: warm.map((v) => Math.round(v)),
    };
    console.log(
      `${profile.padEnd(10)} visible ${JSON.parse(expected).length}  first in a new 5 s window: median ${summarize(cold).p50} ms` +
        `  same revision again: median ${summarize(warm).p50} ms`,
    );
  }
  api.close();
  spicedb.close();
} finally {
  await stop();
}
out.problems = problems;
console.log(`problems (wrong answers or a reused revision): ${problems}`);
if (a.out) writeJson(a.out, out);
process.exit(problems ? 1 : 0);
