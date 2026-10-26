// Load one step's app and approaches from a tree (the working tree or an
// exported step tag) and give the harness one interface for all three.
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

export const ALL = ['ifs', 'cerbos', 'spicedb'];

export async function loadApp(tree) {
  return import(pathToFileURL(join(resolve(tree), 'app/db.js')).href);
}

export async function openApproaches(tree, db, names) {
  const out = {};
  for (const name of names) {
    const mod = await import(pathToFileURL(join(resolve(tree), 'approaches', name, 'index.js')).href);
    const t0 = performance.now();
    out[name] = await mod.open(db);
    out[name].openMs = Math.round((performance.now() - t0) * 10) / 10;
  }
  return out;
}

export function namesFrom(arg) {
  if (!arg || arg === true) return ALL;
  const names = String(arg).split(',');
  for (const n of names) if (!ALL.includes(n)) throw new Error(`unknown approach ${n}`);
  return names;
}
