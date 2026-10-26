// Does the LookupResources page size change the list time? The step 4 schema,
// 10,000 documents, the three list profiles, page sizes 0 (no limit), 1000, 100.
//   node harness/lookup-pages.js --tree=.steps/step4 --out=file
import { setTimeout as sleep } from 'node:timers/promises';
import { v1 } from '@authzed/authzed-node';
import { args, stamp, summarize, writeJson, now } from './lib.js';
import { generateWorld, listProfiles } from './world.js';
import { loadApp, openApproaches } from './approaches.js';
import { startServers, SPICEDB_KEY } from './servers.js';

const a = args({ tree: '.', docs: '10000', iters: '10', warmup: '2' });
const docs = Number(a.docs);
const iters = Number(a.iters);
const warmup = Number(a.warmup);
const world = generateWorld({ docs });
const { createDb } = await loadApp(a.tree);
const db = createDb(world);
const stop = await startServers(a.tree, ['spicedb']);
const out = { stamp: stamp(a.tree, { docs, iters, warmup }), profiles: {} };
try {
  await openApproaches(a.tree, db, ['spicedb']);
  await sleep(6000);
  const api = v1.NewClient(SPICEDB_KEY, '127.0.0.1:50051', v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS).promises;
  const subject = (u) => v1.SubjectReference.create({ object: v1.ObjectReference.create({ objectType: 'user', objectId: u }) });
  async function lookup(user, limit) {
    const ids = new Set();
    let cursor;
    let requests = 0;
    for (;;) {
      const page = await api.lookupResources(
        v1.LookupResourcesRequest.create({
          resourceObjectType: 'document',
          permission: 'view',
          subject: subject(user),
          optionalLimit: limit,
          optionalCursor: cursor,
        }),
      );
      requests++;
      for (const r of page) ids.add(r.resourceObjectId);
      if (limit === 0 || page.length < limit) break;
      cursor = page[page.length - 1].afterResultCursor;
    }
    return { size: ids.size, requests };
  }
  for (const [profile, user] of Object.entries(listProfiles(world))) {
    out.profiles[profile] = { user, pages: {} };
    for (const limit of [0, 1000, 100]) {
      const times = [];
      let info;
      for (let i = 0; i < warmup + iters; i++) {
        const t0 = now();
        info = await lookup(user, limit);
        if (i >= warmup) times.push(now() - t0);
      }
      out.profiles[profile].pages[limit] = { ...info, latencyMs: summarize(times) };
      console.log(`${profile.padEnd(10)} limit ${String(limit).padEnd(5)} visible ${info.size} requests ${info.requests} median ${summarize(times).p50} ms`);
    }
  }
  api.close();
} finally {
  await stop();
}
if (a.out) writeJson(a.out, out);
