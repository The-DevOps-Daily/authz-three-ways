// The application's own data in SQLite. All three approaches read from here;
// it stays the source of truth for users and documents.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./migrations/', import.meta.url);

export function createDb(world, path = ':memory:') {
  const db = new DatabaseSync(path);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  const insertUser = db.prepare('INSERT INTO users (id, role) VALUES (?, ?)');
  const insertDoc = db.prepare('INSERT INTO documents (id, title) VALUES (?, ?)');
  db.exec('BEGIN');
  for (const u of world.users) insertUser.run(u.id, u.role);
  for (const d of world.documents) insertDoc.run(d.id, `Document ${d.id}`);
  db.exec('COMMIT');
  return db;
}
