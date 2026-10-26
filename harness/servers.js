// Start and stop the two engines on 127.0.0.1 for one run.
import { spawn } from 'node:child_process';
import { openSync, mkdtempSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
export const SPICEDB_KEY = 'authz-three-ways-local';

// A fresh private directory per process (mode 0700 from mkdtemp), and 'wx' so
// an existing file or symlink at the log path is refused, not followed.
let logDir;
let starts = 0;

// Kill the engines even when the harness dies on an uncaught error.
const live = new Set();
process.on('exit', () => {
  for (const p of live) p.kill('SIGTERM');
});
function logFile(name) {
  logDir ??= mkdtempSync(join(tmpdir(), 'authz-three-ways-'));
  return openSync(join(logDir, `${name}-${starts}.log`), 'wx');
}

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
  starts++;
  const procs = [];
  if (names.includes('cerbos')) {
    if (await portOpen(3593)) throw new Error('port 3593 already in use');
    const log = logFile('cerbos');
    const p = spawn(`${root}.bin/cerbos`, ['server', '--config=config.yaml'], {
      cwd: join(tree, 'approaches/cerbos'),
      stdio: ['ignore', log, log],
      env: { ...process.env, CERBOS_NO_TELEMETRY: '1' },
    });
    procs.push(p);
    live.add(p);
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
    const log = logFile('spicedb');
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
    live.add(p);
    await waitFor(() => portOpen(50051), 'spicedb');
  }
  return async function stop() {
    for (const p of procs) {
      p.kill('SIGTERM');
      await new Promise((r) => (p.exitCode !== null ? r() : p.once('exit', r)));
      live.delete(p);
    }
  };
}
