// Authorization as plain application code. check() answers one question;
// list() answers "which documents can this user view" in SQL.

const ROLE_ACTIONS = {
  viewer: ['view'],
  editor: ['view', 'edit'],
  admin: ['view', 'edit', 'delete'],
};

export async function open(db) {
  const getUser = db.prepare('SELECT id, role FROM users WHERE id = ?');
  const getDoc = db.prepare('SELECT id FROM documents WHERE id = ?');
  const allDocs = db.prepare('SELECT id FROM documents');

  return {
    check(userId, action, docId) {
      const user = getUser.get(userId);
      const doc = getDoc.get(docId);
      if (!user || !doc) return false;
      return ROLE_ACTIONS[user.role].includes(action);
    },

    list(userId) {
      const user = getUser.get(userId);
      if (!user || !ROLE_ACTIONS[user.role].includes('view')) return [];
      return allDocs.all().map((r) => r.id);
    },
  };
}
