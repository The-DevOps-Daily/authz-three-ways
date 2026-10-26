// Authorization as Cerbos policies (policies/*.yaml) evaluated by a Cerbos PDP.
// The app reads the principal and resource from SQLite and sends them with
// every request; Cerbos stores no application data.
import { GRPC } from '@cerbos/grpc';
import { PlanKind } from '@cerbos/core';
import { planToSql } from './plan-to-sql.js';

export async function open(db) {
  const cerbos = new GRPC(process.env.CERBOS_GRPC ?? '127.0.0.1:3593', { tls: false });
  const getUser = db.prepare('SELECT id, role FROM users WHERE id = ?');
  const getTeams = db.prepare('SELECT team_id FROM team_members WHERE user_id = ?');
  const getDoc = db.prepare('SELECT id, team_id FROM documents WHERE id = ?');
  const getShares = db.prepare('SELECT user_id, level FROM shares WHERE document_id = ?');
  const allDocs = db.prepare('SELECT id FROM documents');

  function principalOf(userId) {
    const user = getUser.get(userId);
    if (!user) return null;
    const teams = getTeams.all(userId).map((r) => r.team_id);
    return { id: user.id, roles: [user.role], attr: { teams } };
  }

  function resourceOf(doc) {
    const shares = getShares.all(doc.id);
    const usersWith = (level) => shares.filter((s) => s.level === level).map((s) => s.user_id);
    return {
      kind: 'document',
      id: doc.id,
      attr: { team: doc.team_id, viewers: usersWith('view'), editors: usersWith('edit') },
    };
  }

  return {
    async check(userId, action, docId) {
      const principal = principalOf(userId);
      const doc = getDoc.get(docId);
      if (!principal || !doc) return false;
      const result = await cerbos.checkResource({
        principal,
        resource: resourceOf(doc),
        actions: [action],
      });
      return result.isAllowed(action) === true;
    },

    async list(userId) {
      const principal = principalOf(userId);
      if (!principal) return [];
      const plan = await cerbos.planResources({
        principal,
        resource: { kind: 'document' },
        action: 'view',
      });
      if (plan.kind === PlanKind.ALWAYS_ALLOWED) return allDocs.all().map((r) => r.id);
      if (plan.kind === PlanKind.ALWAYS_DENIED) return [];
      const params = [];
      const where = planToSql(plan.condition, params);
      return db
        .prepare(`SELECT d.id FROM documents d WHERE ${where}`)
        .all(...params)
        .map((r) => r.id);
    },

    close() {
      cerbos.close();
    },
  };
}
