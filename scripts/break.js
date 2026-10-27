// Leave out part of the step 4 change in each design and show that the
// expected-decisions table catches it. Each break must produce mismatches,
// and only of the kinds listed, or this script fails.
//   node scripts/break.js   (writes results/breaks.json)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

const BREAKS = [
  {
    name: 'ifs-forgot-the-list-query',
    approach: 'ifs',
    what: 'check() got the contractor rule, list() kept its step 3 queries',
    file: 'approaches/ifs/index.js',
    edits: [
      {
        from: `  // Contractors see only documents of their own teams.
  const contractorFilter = \`(:contractor = 0 OR d.team_id IN
    (SELECT team_id FROM team_members WHERE user_id = :user))\`;
  const allDocs = db.prepare(\`SELECT d.id FROM documents d WHERE \${contractorFilter}\`);
  const visibleDocs = db.prepare(\`
    SELECT d.id FROM documents d
    JOIN team_members m ON m.team_id = d.team_id
    WHERE m.user_id = :user
    UNION
    SELECT s.document_id FROM shares s
    JOIN documents d ON d.id = s.document_id
    WHERE s.user_id = :user AND \${contractorFilter}\`);`,
        to: `  const allDocs = db.prepare('SELECT id FROM documents');
  const visibleDocs = db.prepare(\`
    SELECT d.id FROM documents d
    JOIN team_members m ON m.team_id = d.team_id
    WHERE m.user_id = ?
    UNION
    SELECT s.document_id FROM shares s
    WHERE s.user_id = ?\`);`,
      },
      {
        from: `      const params = { user: userId, contractor: user.contractor };
      if (user.role === 'admin') return allDocs.all(params).map((r) => r.id);
      return visibleDocs.all(params).map((r) => r.id);`,
        to: `      if (user.role === 'admin') return allDocs.all().map((r) => r.id);
      return visibleDocs.all(userId, userId).map((r) => r.id);`,
      },
    ],
    expectKinds: ['list'],
  },
  {
    name: 'cerbos-forgot-the-attribute',
    approach: 'cerbos',
    what: 'the policy has the deny rule, the app does not send principal.attr.contractor',
    file: 'approaches/cerbos/index.js',
    from: 'attr: { teams, contractor: user.contractor === 1 }',
    to: 'attr: { teams }',
    expectKinds: ['check', 'list'],
  },
  {
    name: 'spicedb-forgot-the-sync',
    approach: 'spicedb',
    what: 'the schema has the exclusion, sync.js does not write org#contractor',
    file: 'approaches/spicedb/sync.js',
    from: "    if (u.contractor) out.push(touch('org', ORG, 'contractor', 'user', u.id));\n",
    to: '',
    expectKinds: ['check', 'list'],
  },
];

const results = [];
let ok = true;
for (const b of BREAKS) {
  const tree = `${root}.steps/break-${b.name}`;
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(tree, { recursive: true });
  const tar = execFileSync('git', ['-C', root, 'archive', 'step4-spicedb', 'app', 'approaches']);
  execFileSync('tar', ['-x', '-C', tree], { input: tar });
  const path = `${tree}/${b.file}`;
  let src = readFileSync(path, 'utf8');
  for (const e of b.edits ?? [{ from: b.from, to: b.to }]) {
    if (src.split(e.from).length !== 2) throw new Error(`${b.name}: the text to replace is not in ${b.file} exactly once`);
    src = src.replace(e.from, e.to);
  }
  writeFileSync(path, src);

  const out = `${tree}/correctness.json`;
  const r = spawnSync(
    'node',
    [`${root}harness/correctness.js`, '--step=4', `--tree=${tree}`, `--only=${b.approach}`, `--out=${out}`],
    { encoding: 'utf8' },
  );
  const report = JSON.parse(readFileSync(out, 'utf8')).approaches[b.approach];
  const kinds = [...new Set(report.details.map((d) => d.kind))].sort();
  const caught = report.mismatches > 0 && JSON.stringify(kinds) === JSON.stringify([...b.expectKinds].sort());
  if (!caught) ok = false;
  results.push({
    name: b.name,
    what: b.what,
    exitCode: r.status,
    mismatches: report.mismatches,
    kinds,
    caught,
    details: report.details,
  });
  console.log(`${b.name.padEnd(30)} mismatches ${report.mismatches} (${kinds.join(', ')}) ${caught ? 'caught' : 'NOT CAUGHT AS EXPECTED'}`);
  for (const d of report.details) console.log('    ', JSON.stringify(d));
  rmSync(tree, { recursive: true, force: true });
}
mkdirSync(`${root}results`, { recursive: true });
writeFileSync(`${root}results/breaks.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
process.exit(ok ? 0 : 1);
