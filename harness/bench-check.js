// Single-check latency. Random (user, action, document) triples from a seeded
// generated world, concurrency 1, the three approaches interleaved per sample
// in rotating order so drift on the machine lands on all of them equally.
//   node harness/bench-check.js --step=4 --docs=10000 --samples=10000 --out=file [--raw=file]
import { setTimeout as sleep } from 'node:timers/promises';
import { args, mulberry32, pick, stamp, summarize, writeJson, now } from './lib.js';
import { generateWorld } from './world.js';
import { loadApp, openApproaches, namesFrom } from './approaches.js';
import { readFileSync } from 'node:fs';
import { startServers, serverLog } from './servers.js';

const a = args({ tree: '.', docs: '10000', samples: '10000', warmup: '1000', seed: '7' });
const step = Number(a.step);
if (!(step >= 1 && step <= 4)) throw new Error('--step=1..4 is required');
const names = namesFrom(a.only);
const docs = Number(a.docs);
const samples = Number(a.samples);
const warmup = Number(a.warmup);
const ACTIONS = ['view', 'edit', 'delete'];

const world = generateWorld({ docs });
const { createDb } = await loadApp(a.tree);
const db = createDb(world);
const stop = await startServers(a.tree, names);
const st = stamp(a.tree, { step, docs, samples, warmup, seed: Number(a.seed), approaches: names });

const rng = mulberry32(Number(a.seed));
const triple = () => [pick(rng, world.users).id, pick(rng, ACTIONS), pick(rng, world.documents).id];

const out = { stamp: st, approaches: {} };
try {
  const impls = await openApproaches(a.tree, db, names);
  // Let SpiceDB's 5 s revision quantization window pass, so the run sees the
  // steady state of an app whose data was written a while ago.
  await sleep(6000);

  for (let i = 0; i < warmup; i++) {
    const [u, act, d] = triple();
    for (const n of names) await impls[n].check(u, act, d);
  }

  const times = Object.fromEntries(names.map((n) => [n, new Float64Array(samples)]));
  const allows = Object.fromEntries(names.map((n) => [n, 0]));
  // A failed call is counted, not timed, and its sample is left out of the
  // agreement check. Nothing is retried.
  const errors = Object.fromEntries(names.map((n) => [n, []]));
  const disagreements = [];
  const runStart = now();
  for (let i = 0; i < samples; i++) {
    const [u, act, d] = triple();
    const res = {};
    for (let k = 0; k < names.length; k++) {
      const n = names[(i + k) % names.length];
      const t0 = now();
      try {
        res[n] = await impls[n].check(u, act, d);
        times[n][i] = now() - t0;
        if (res[n]) allows[n]++;
      } catch (e) {
        times[n][i] = NaN;
        errors[n].push({ sample: i, atMs: Math.round(now() - runStart), message: e.message });
      }
    }
    const vals = new Set(Object.values(res));
    if (Object.keys(res).length === names.length && vals.size > 1) {
      disagreements.push({ user: u, action: act, document: d, ...res });
    }
  }
  for (const n of names) {
    out.approaches[n] = {
      openMs: impls[n].openMs,
      allowed: allows[n],
      errors: { count: errors[n].length, all: errors[n] },
      latencyMs: summarize(Array.from(times[n]).filter((v) => !Number.isNaN(v))),
    };
    await impls[n].close?.();
  }
  out.disagreements = { count: disagreements.length, first: disagreements.slice(0, 20) };
  out.loadavgAtEnd = (await import('node:os')).loadavg().map((x) => Math.round(x * 100) / 100);
  if (a.raw) {
    writeJson(a.raw, {
      stamp: st,
      unit: 'ms',
      samples: Object.fromEntries(
        names.map((n) => [n, Array.from(times[n], (v) => (Number.isNaN(v) ? null : Math.round(v * 1000) / 1000))]),
      ),
    });
  }
} finally {
  await stop();
}

// Cerbos logs its own handling time for every request (grpc.time_ms). Taken
// from the measured part of the run only: the last `samples` CheckResources.
if (names.includes('cerbos')) {
  const handled = readFileSync(serverLog('cerbos'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('"grpc.method":"CheckResources"') && l.includes('"grpc.code"'))
    .map((l) => Number(JSON.parse(l)['grpc.time_ms']));
  out.cerbosServerHandlingMs = summarize(handled.slice(-samples));
  console.log(`cerbos server-side handling (from its log): p50 ${out.cerbosServerHandlingMs.p50} ms  p99 ${out.cerbosServerHandlingMs.p99} ms`);
}

for (const n of names) {
  const l = out.approaches[n].latencyMs;
  console.log(
    `step ${step} docs=${docs} ${n.padEnd(8)} p50 ${l.p50} ms  p95 ${l.p95} ms  p99 ${l.p99} ms  max ${l.max} ms  allowed ${out.approaches[n].allowed}/${samples}  errors ${out.approaches[n].errors.count}`,
  );
}
console.log(`disagreements: ${out.disagreements.count}`);
if (a.out) writeJson(a.out, out);
