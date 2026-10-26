// Start and stop the two engines on 127.0.0.1 for one run.
import { spawn } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
export const SPICEDB_KEY = 'authz-three-ways-local';
const logDir = join(tmpdir(), 'authz-three-ways-logs');

function portOpen(port) {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port }, () => {
      s.end();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });
}

async function waitFor(fn, what, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function startServers(tree, names) {
  mkdirSync(logDir, { recursive: true });
  const procs = [];
  if (names.includes('cerbos')) {
    if (await portOpen(3593)) throw new Error('port 3593 already in use');
    const log = openSync(join(logDir, 'cerbos.log'), 'w');
    const p = spawn(`${root}.bin/cerbos`, ['server', '--config=config.yaml'], {
      cwd: join(tree, 'approaches/cerbos'),
      stdio: ['ignore', log, log],
      env: { ...process.env, CERBOS_NO_TELEMETRY: '1' },
    });
    procs.push(p);
    await waitFor(async () => {
      try {
        const r = await fetch('http://127.0.0.1:3592/_cerbos/health');
        return r.ok;
      } catch {
        return false;
      }
    }, 'cerbos');
  }
  if (names.includes('spicedb')) {
    if (await portOpen(50051)) throw new Error('port 50051 already in use');
    const log = openSync(join(logDir, 'spicedb.log'), 'w');
    const p = spawn(
      `${root}.bin/spicedb`,
      [
        'serve',
        `--grpc-preshared-key=${SPICEDB_KEY}`,
        '--datastore-engine=memory',
        '--grpc-addr=127.0.0.1:50051',
        '--http-enabled=false',
        '--metrics-enabled=false',
        '--telemetry-endpoint=',
        '--log-level=warn',
      ],
      { stdio: ['ignore', log, log] },
    );
    procs.push(p);
    await waitFor(() => portOpen(50051), 'spicedb');
  }
  return async function stop() {
    for (const p of procs) {
      p.kill('SIGTERM');
      await new Promise((r) => (p.exitCode !== null ? r() : p.once('exit', r)));
    }
  };
}
