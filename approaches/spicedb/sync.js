// Copy the app's rows into SpiceDB relationships. SQLite stays the source of
// truth; every app write that changes these rows must also be written here.
import { v1 } from '@authzed/authzed-node';

export const ORG = 'main';

function touch(resourceType, resourceId, relation, subjectType, subjectId) {
  return v1.RelationshipUpdate.create({
    operation: v1.RelationshipUpdate_Operation.TOUCH,
    relationship: v1.Relationship.create({
      resource: v1.ObjectReference.create({ objectType: resourceType, objectId: resourceId }),
      relation,
      subject: v1.SubjectReference.create({
        object: v1.ObjectReference.create({ objectType: subjectType, objectId: subjectId }),
      }),
    }),
  });
}

export function relationshipsFrom(db) {
  const out = [];
  for (const u of db.prepare('SELECT id, role FROM users').all()) {
    out.push(touch('org', ORG, u.role, 'user', u.id));
  }
  for (const t of db.prepare('SELECT id FROM teams').all()) {
    out.push(touch('team', t.id, 'org', 'org', ORG));
  }
  for (const m of db.prepare('SELECT team_id, user_id FROM team_members').all()) {
    out.push(touch('team', m.team_id, 'member', 'user', m.user_id));
  }
  for (const d of db.prepare('SELECT id, team_id FROM documents').all()) {
    out.push(touch('document', d.id, 'org', 'org', ORG));
    out.push(touch('document', d.id, 'team', 'team', d.team_id));
  }
  for (const s of db.prepare('SELECT document_id, user_id, level FROM shares').all()) {
    out.push(touch('document', s.document_id, s.level === 'edit' ? 'editor' : 'viewer', 'user', s.user_id));
  }
  return out;
}

// Returns the ZedToken of the last write, for at_least_as_fresh reads.
export async function syncAll(api, db) {
  const updates = relationshipsFrom(db);
  let token;
  for (let i = 0; i < updates.length; i += 1000) {
    const res = await api.writeRelationships(
      v1.WriteRelationshipsRequest.create({ updates: updates.slice(i, i + 1000) }),
    );
    token = res.writtenAt;
  }
  return token;
}
