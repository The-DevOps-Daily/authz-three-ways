// Authorization as a SpiceDB schema (schema.zed) plus relationships copied
// from the app's data (sync.js). Checks and lists are answered by SpiceDB.
import { readFileSync } from 'node:fs';
import { v1 } from '@authzed/authzed-node';
import { syncAll } from './sync.js';

const schema = readFileSync(new URL('./schema.zed', import.meta.url), 'utf8');
// LookupResources returns at most --max-lookup-resources-limit (default 1000)
// results per call, so a full list pages with the cursor.
const PAGE = 1000;

const ref = (objectType, objectId) => v1.ObjectReference.create({ objectType, objectId });
const userRef = (userId) => v1.SubjectReference.create({ object: ref('user', userId) });

export async function open(db) {
  const client = v1.NewClient(
    process.env.SPICEDB_KEY ?? 'authz-three-ways-local',
    process.env.SPICEDB_GRPC ?? '127.0.0.1:50051',
    v1.ClientSecurity.INSECURE_PLAINTEXT_CREDENTIALS,
  );
  const api = client.promises;
  await api.writeSchema(v1.WriteSchemaRequest.create({ schema }));
  const writtenAt = await syncAll(api, db);
  const consistency = v1.Consistency.create({
    requirement: { oneofKind: 'atLeastAsFresh', atLeastAsFresh: writtenAt },
  });

  const self = {
    async check(userId, action, docId) {
      const res = await api.checkPermission(
        v1.CheckPermissionRequest.create({
          resource: ref('document', docId),
          permission: action,
          subject: userRef(userId),
          consistency,
        }),
      );
      return res.permissionship === v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION;
    },

    async list(userId) {
      const ids = [];
      let cursor;
      let requests = 0;
      for (;;) {
        const page = await api.lookupResources(
          v1.LookupResourcesRequest.create({
            resourceObjectType: 'document',
            permission: 'view',
            subject: userRef(userId),
            consistency,
            optionalLimit: PAGE,
            optionalCursor: cursor,
          }),
        );
        requests++;
        for (const r of page) {
          if (r.permissionship === v1.LookupPermissionship.HAS_PERMISSION) ids.push(r.resourceObjectId);
        }
        if (page.length < PAGE) break;
        cursor = page[page.length - 1].afterResultCursor;
      }
      self.lastList = { requests };
      return ids;
    },

    close() {
      client.close();
    },
  };
  return self;
}
