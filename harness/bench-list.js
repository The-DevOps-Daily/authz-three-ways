// "Which documents can this user view?" for three fixed profiles, at each
// document count. All three answers must be identical before any timing.
// --crosscheck also checks every document one by one and compares with the list.
//   node harness/bench-list.js --step=4 --docs=1000,10000 --iters=20 --out=file
import { setTimeout as sleep } from 'node:timers/promises';
import { loadavg } from 'node:os';
import { args, stamp, summarize, writeJson, now } from './lib.js';
import { generateWorld, listProfiles } from './world.js';
import { loadApp, openApproaches, namesFrom } from './approaches.js';
import { startServers } from './servers.js';

const a = args({ tree: '.', docs: '1000,10000', iters: '20', warmup: '3' });
const step = Number(a.step);
if (!(step >= 1 && step <= 4)) throw new Error('--step=1..4 is required');
const names = namesFrom(a.only);
const iters = Number(a.iters);
const warmup = Number(a.warmup);
const { createDb } = await loadApp(a.tree);

const out = { stamp: stamp(a.tree, { step, iters, warmup, approaches: names }), runs: [] };
let problems = 0;
for (const docs of String(a.docs).split(',').map(Number)) {
  const world = generateWorld({ docs });
  const profiles = listProfiles(world);
  const db = createDb(world);
  const stop = await startServers(a.tree, names);
  try {
    const impls = await openApproaches(a.tree, db, names);
    await sleep(6000);
    const run = { docs, open: {}, profiles: {} };
    for (const n of names) run.open[n] = { openMs: impls[n].openMs };
    for (const [profile, user] of Object.entries(profiles)) {
      const answers = {};
      const info = {};
      for (const n of names) {
        answers[n] = [...(await impls[n].list(user))].sort();
        info[n] = impls[n].lastList ?? null;
      }
      const ref = JSON.stringify(answers[names[0]]);
      const agree = names.every((n) => JSON.stringify(answers[n]) === ref);
      if (!agree) problems++;
      const p = { user, visible: Object.fromEntries(names.map((n) => [n, answers[n].length])), agree, info };

      if (a.crosscheck) {
        p.crosscheck = {};
        for (const n of names) {
          const listed = new Set(answers[n]);
          let bad = 0;
          for (const d of world.documents) {
            if ((await impls[n].check(user, 'view', d.id)) !== listed.has(d.id)) bad++;
          }
          p.crosscheck[n] = { documents: world.documents.length, listVsCheckMismatches: bad };
          if (bad) problems++;
        }
      }

      const times = Object.fromEntries(names.map((n) => [n, []]));
      for (let i = 0; i < warmup + iters; i++) {
        for (let k = 0; k < names.length; k++) {
          const n = names[(i + k) % names.length];
          const t0 = now();
          await impls[n].list(user);
          const dt = now() - t0;
          if (i >= warmup) times[n].push(dt);
        }
      }
      p.latencyMs = Object.fromEntries(names.map((n) => [n, summarize(times[n])]));
      run.profiles[profile] = p;
      console.log(
        `step ${step} docs=${docs} ${profile.padEnd(10)} (${user}) visible ${JSON.stringify(p.visible)} agree=${agree}` +
          (p.crosscheck ? ` crosscheck=${JSON.stringify(p.crosscheck)}` : ''),
      );
      for (const n of names) {
        const l = p.latencyMs[n];
        console.log(`    ${n.padEnd(8)} median ${l.p50} ms  min ${l.min} ms  max ${l.max} ms`);
      }
    }
    for (const n of names) await impls[n].close?.();
    run.loadavgAtEnd = loadavg().map((x) => Math.round(x * 100) / 100);
    out.runs.push(run);
  } finally {
    await stop();
  }
}
out.problems = problems;
if (a.out) writeJson(a.out, out);
process.exit(problems ? 1 : 0);
