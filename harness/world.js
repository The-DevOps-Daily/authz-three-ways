// The "world": users, teams, documents and shares, with every field the final
// step needs. Each step's app/db.js loads only what its schema knows about.
import { readFileSync } from 'node:fs';
import { mulberry32, pick } from './lib.js';

const root = new URL('..', import.meta.url).pathname;

export function fixtureWorld() {
  return JSON.parse(readFileSync(`${root}fixture/fixture.json`, 'utf8'));
}

export function expectedRows() {
  const lines = readFileSync(`${root}fixture/expected.csv`, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'));
  const header = lines.shift().split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [header[i], v])));
}

const pad = (n, w) => String(n).padStart(w, '0');

// 200 users in 20 teams. 4% admins, 46% editors, 50% viewers. 10% of the
// non-admins are contractors with exactly one team. Everyone else is in 1 to 3
// teams. 30% of documents are shared with 1 or 2 users, 30% of shares are edit.
export function generateWorld({ docs, users = 200, teams = 20, seed = 42 }) {
  const rng = mulberry32(seed);
  const teamIds = Array.from({ length: teams }, (_, i) => `t${pad(i + 1, 2)}`);
  const userList = [];
  for (let i = 0; i < users; i++) {
    const r = rng();
    const role = r < 0.04 ? 'admin' : r < 0.5 ? 'editor' : 'viewer';
    const contractor = role !== 'admin' && rng() < 0.1;
    const count = contractor ? 1 : 1 + Math.floor(rng() * 3);
    const mine = new Set();
    while (mine.size < count) mine.add(pick(rng, teamIds));
    userList.push({ id: `u${pad(i + 1, 3)}`, role, teams: [...mine].sort(), contractor });
  }
  const docList = [];
  const shares = [];
  for (let i = 0; i < docs; i++) {
    const id = `d${pad(i + 1, 5)}`;
    docList.push({ id, team: pick(rng, teamIds) });
    if (rng() < 0.3) {
      const n = 1 + Math.floor(rng() * 2);
      const seen = new Set();
      for (let k = 0; k < n; k++) {
        const u = pick(rng, userList).id;
        if (seen.has(u)) continue;
        seen.add(u);
        shares.push({ doc: id, user: u, level: rng() < 0.3 ? 'edit' : 'view' });
      }
    }
  }
  return { teams: teamIds, users: userList, documents: docList, shares };
}

// Fixed profiles for the list benchmark, chosen by rule so they are the same
// users at every step and every document count.
export function listProfiles(world) {
  const docTeam = new Map(world.documents.map((d) => [d.id, d.team]));
  const sharesOf = (u) => world.shares.filter((s) => s.user === u.id);
  const admin = world.users.find((u) => u.role === 'admin' && !u.contractor);
  const member = world.users.find(
    (u) => u.role === 'editor' && !u.contractor && u.teams.length === 2 && sharesOf(u).length > 0,
  );
  const contractor = world.users.find(
    (u) => u.contractor && sharesOf(u).some((s) => !u.teams.includes(docTeam.get(s.doc))),
  );
  return { admin: admin.id, member: member.id, contractor: contractor.id };
}
