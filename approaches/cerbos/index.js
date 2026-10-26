// Authorization as Cerbos policies (policies/*.yaml) evaluated by a Cerbos PDP.
// The app reads the principal and resource from SQLite and sends them with
// every request; Cerbos stores no application data.
import { GRPC } from '@cerbos/grpc';
import { PlanKind } from '@cerbos/core';

export async function open(db) {
  const cerbos = new GRPC(process.env.CERBOS_GRPC ?? '127.0.0.1:3593', { tls: false });
  const getUser = db.prepare('SELECT id, role FROM users WHERE id = ?');
  const getDoc = db.prepare('SELECT id FROM documents WHERE id = ?');
  const allDocs = db.prepare('SELECT id FROM documents');

  function principalOf(userId) {
    const user = getUser.get(userId);
    return user && { id: user.id, roles: [user.role] };
  }

  return {
    async check(userId, action, docId) {
      const principal = principalOf(userId);
      const doc = getDoc.get(docId);
      if (!principal || !doc) return false;
      const result = await cerbos.checkResource({
        principal,
        resource: { kind: 'document', id: doc.id },
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
      throw new Error('conditional plans are not supported yet');
    },

    close() {
      cerbos.close();
    },
  };
}
