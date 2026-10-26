// Authorization as plain application code. check() answers one question;
// list() answers "which documents can this user view" in SQL.

const ROLE_ACTIONS = {
  viewer: ['view'],
  editor: ['view', 'edit'],
  admin: ['view', 'edit', 'delete'],
};

const SHARE_ACTIONS = {
  view: ['view'],
  edit: ['view', 'edit'],
};

export async function open(db) {
  const getUser = db.prepare('SELECT id, role FROM users WHERE id = ?');
  const getDoc = db.prepare('SELECT id, team_id FROM documents WHERE id = ?');
  const isMember = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?');
  const getShare = db.prepare('SELECT level FROM shares WHERE document_id = ? AND user_id = ?');
  const allDocs = db.prepare('SELECT id FROM documents');
  const visibleDocs = db.prepare(`
    SELECT d.id FROM documents d
    JOIN team_members m ON m.team_id = d.team_id
    WHERE m.user_id = ?
    UNION
    SELECT s.document_id FROM shares s
    WHERE s.user_id = ?`);

  return {
    check(userId, action, docId) {
      const user = getUser.get(userId);
      const doc = getDoc.get(docId);
      if (!user || !doc) return false;
      // A share grants access whatever the user's role and teams are.
      const share = getShare.get(docId, userId);
      if (share && SHARE_ACTIONS[share.level].includes(action)) return true;
      // Roles other than admin apply only to documents of the user's teams.
      if (user.role !== 'admin' && !isMember.get(doc.team_id, userId)) return false;
      return ROLE_ACTIONS[user.role].includes(action);
    },

    list(userId) {
      const user = getUser.get(userId);
      if (!user) return [];
      if (user.role === 'admin') return allDocs.all().map((r) => r.id);
      return visibleDocs.all(userId, userId).map((r) => r.id);
    },
  };
}
