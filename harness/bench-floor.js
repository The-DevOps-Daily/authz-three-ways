// A reference point for the cost of a call on this machine: a request that
// does no authorization work, to each engine, next to a Node-to-Node TCP echo.
// It is a different RPC from a check, so a check minus this is not the cost
// of the decision.
//   node harness/bench-floor.js --out=file
import net from 'node:net';
import { spawn } from 'node:child_process';
import { GRPC } from '@cerbos/grpc';
import { v1 } from '@authzed/authzed-node';
import { args, stamp, summarize, writeJson, now } from './lib.js';
import { startServers, SPICEDB_KEY } from './servers.js';

const a = args({ tree: '.', samples: '5000', warmup: '500' });
const samples = Number(a.samples);
const warmup = Number(a.warmup);
const st = stamp(a.tree, { samples, warmup });

// A TCP echo server in a second Node process, so the echo crosses processes like the engines do.
const echo = spawn(process.execPath, [
  '-e',
  "const s=require('net').createServer(c=>{c.setNoDelay(true);c.on('data',d=>c.write(d))});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))",
]);
const port = await new Promise((r) => echo.stdout.once('data', (d) => r(Number(String(d).trim()))));
const sock = net.connect(port, '127.0.0.1');
sock.setNoDelay(true);
await new Promise((r) => sock.once('connect', r));
const tcpEcho = () => new Promise((r) => { sock.once('data', r); sock.write('x'); });

const stop = await startServers(a.tree, ['cerbos', 'spicedb']);
const out = { stamp: st };
try {
  const cerbos = new GRPC('127.0.0.1:3593', { tls: false });
  const spicedb = v1.NewClient(SPICEDB_KEY, '127.0.0.1:50051', v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS).promises;
  await spicedb.writeSchema(v1.WriteSchemaRequest.create({ schema: 'definition user {}\n' }));
  const calls = {
    'node-tcp-echo': tcpEcho,
    'cerbos-serverinfo-grpc': () => cerbos.serverInfo(),
    'spicedb-readschema-grpc': () => spicedb.readSchema(v1.ReadSchemaRequest.create({})),
  };
  const names = Object.keys(calls);
  const times = Object.fromEntries(names.map((n) => [n, []]));
  for (let i = 0; i < warmup + samples; i++) {
    for (let k = 0; k < names.length; k++) {
      const n = names[(i + k) % names.length];
      const t0 = now();
      await calls[n]();
      if (i >= warmup) times[n].push(now() - t0);
    }
  }
  out.latencyMs = Object.fromEntries(names.map((n) => [n, summarize(times[n])]));
  cerbos.close();
  spicedb.close();
} finally {
  await stop();
  sock.destroy();
  echo.kill();
}
for (const [n, l] of Object.entries(out.latencyMs)) {
  console.log(`${n.padEnd(24)} p50 ${l.p50} ms  p95 ${l.p95} ms  p99 ${l.p99} ms`);
}
if (a.out) writeJson(a.out, out);
