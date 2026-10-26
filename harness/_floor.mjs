import { GRPC } from '@cerbos/grpc';
import { v1 } from '@authzed/authzed-node';
import { summarize, now } from './lib.js';
const c = new GRPC('127.0.0.1:3593', { tls: false });
const s = v1.NewClient('authz-three-ways-local', '127.0.0.1:50051', v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS).promises;
await s.writeSchema(v1.WriteSchemaRequest.create({ schema: 'definition user {}\ndefinition doc {\n relation viewer: user\n permission view = viewer\n}\n' }));
const t = { cerbosInfo: [], cerbosCheck: [], spicedbSchema: [], spicedbCheck: [] };
const ref = (objectType, objectId) => v1.ObjectReference.create({ objectType, objectId });
for (let i = 0; i < 1500; i++) {
  let t0 = now(); await c.serverInfo(); const a = now() - t0;
  t0 = now(); await c.checkResource({ principal: { id: 'u', roles: ['viewer'] }, resource: { kind: 'nothing', id: 'x' }, actions: ['view'] }); const b = now() - t0;
  t0 = now(); await s.readSchema(v1.ReadSchemaRequest.create({})); const d = now() - t0;
  t0 = now(); await s.checkPermission(v1.CheckPermissionRequest.create({ resource: ref('doc', 'd' + i), permission: 'view', subject: v1.SubjectReference.create({ object: ref('user', 'u') }) })); const e = now() - t0;
  if (i >= 300) { t.cerbosInfo.push(a); t.cerbosCheck.push(b); t.spicedbSchema.push(d); t.spicedbCheck.push(e); }
}
for (const [k, v] of Object.entries(t)) if (v.length) console.log(k.padEnd(14), JSON.stringify(summarize(v)));
c.close(); s.close();
