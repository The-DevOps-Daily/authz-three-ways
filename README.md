# authz-three-ways

The same permission model written three ways, grown in four steps, checked
against one hand-written table at every step, and measured:

1. **ifs**: if-statements in the application, plus a SQL query for lists.
2. **cerbos**: Cerbos policy files, evaluated by a local Cerbos PDP.
3. **spicedb**: a SpiceDB schema and relationships, Zanzibar style.

```bash
npm ci
./scripts/fetch-binaries.sh   # Cerbos 0.57.0 + SpiceDB 1.57.0 release binaries into .bin/, SHA-256 checked
./scripts/run-steps.sh        # correctness and both benchmarks against every step's code
./scripts/run-final.sh        # the headline step 4 numbers, three repetitions
./scripts/run-steps-cache.sh  # SpiceDB lists, cold and warm cache, at every step
node scripts/summary.js       # the tables in results/summary.md
node scripts/diffstat.js      # lines and files changed per step per design, read from git
node scripts/break.js         # leave out part of the late rule in each design: the table must catch it
rm -rf .bin .steps            # remove the binaries and the exported step trees
```

Needs Node.js 22.13 or later (for `node:sqlite`) on Linux arm64 or amd64. No
Docker. Both engines run on 127.0.0.1 and stop when a run ends.

The write-up is on DevOps Daily:
[Moving Authorization Out of Your App Code: If-Statements vs Cerbos vs SpiceDB, Measured](https://devops-daily.com/posts/authorization-if-statements-vs-cerbos-vs-spicedb).

## The four steps

The rules were fixed in [CLAIM.md](CLAIM.md) before any code existed, together
with what would prove the claim wrong. Actions are `view`, `edit` and `delete`.

1. **Roles.** One org role per user: `viewer`, `editor` or `admin`.
2. **Teams.** Each document belongs to a team. `viewer` and `editor` apply only
   to documents of the user's own teams. `admin` sees everything.
3. **Sharing.** A document can be shared with one user as `view` or `edit`.
4. **The late rule.** Contractors get no access to documents outside their own
   teams. This overrides every grant above, including `admin` and shares.

## How the history is laid out

Every step is four commits, each with a tag:

- `step<N>-data`: the shared change to the app's SQLite schema (`app/`).
- `step<N>-ifs`, `step<N>-cerbos`, `step<N>-spicedb`: that design's change, and
  nothing else.

So `git show step4-cerbos` is exactly what the late rule cost in Cerbos, and
`scripts/diffstat.js` counts it. One later commit changed a comment in
`approaches/spicedb/index.js` (no code); the run scripts use the tags, so the
recorded runs used the code exactly as tagged. `step<N>-spicedb` is the last commit of step N,
so it holds all three designs at that step; the run scripts export it to
`.steps/step<N>/` and run the harness from `HEAD` against it.

## Files

- `CLAIM.md`: the claim, the rules of all four steps and the method, written first.
- `fixture/fixture.json`, `fixture/expected.csv`: seven users, two teams, four
  documents, four shares, and the expected decision for all 84
  (user, action, document) rows at every step, written by hand.
- `app/`: the application's own data. `db.js` loads a world into SQLite;
  `migrations/` gains one file per step.
- `approaches/ifs/index.js`: `check()` in JavaScript, `list()` in SQL.
- `approaches/cerbos/`: `policies/*.yaml`, `index.js` (reads the principal and
  resource attributes from SQLite, calls CheckResources and PlanResources),
  `plan-to-sql.js` (turns a query plan into a SQL `WHERE`), `config.yaml`.
- `approaches/spicedb/`: `schema.zed`, `sync.js` (copies the app's rows into
  relationships), `index.js` (CheckPermission, and LookupResources with paging).
- `harness/correctness.js`: runs `expected.csv` against each design at one
  step, including "list everything this user can view".
- `harness/bench-check.js`: single-check latency. Random (user, action,
  document) triples from a seeded world of 200 users, 20 teams and 10,000
  documents, concurrency 1, the three designs interleaved per sample. Also
  counts any triple where the designs disagree.
- `harness/bench-list.js`: "which documents can this user view" for an admin,
  a member and a contractor, at 1,000 and 10,000 documents. The three answers
  must be identical before anything is timed. `--crosscheck` also checks every
  document one by one and compares it with the list.
- `harness/bench-floor.js`: a request to each engine that does no
  authorization work, next to a Node-to-Node TCP echo: a reference point for
  what a call costs on this machine.
- `harness/lookup-pages.js`: LookupResources at page sizes 0 (no limit), 1000
  and 100.
- `harness/spicedb-list-cache.js`: SpiceDB lists timed twice on purpose: the
  first call in a new 5 s revision window (cold cache), then the same call at
  the same revision (warm).
- `harness/spicedb-page.js`: the first 50 visible documents, through
  LookupResources and through CheckBulkPermissions over candidate pages, as
  SpiceDB's docs suggest for large result sets.
- `harness/show-plans.js`: the Cerbos query plan and the SQL our adapter makes
  of it, for every fixture user.
- `scripts/variant.js`: re-runs the list benchmark with one deliberate code
  change (an uncorrelated `IN` subquery in the Cerbos adapter).
- `scripts/break.js`: leaves out part of the step 4 change in each design;
  the table must catch every break.
- `scripts/quiet.sh`: waits for a low load average before each timed run.
- `results/`: every recorded run. Each JSON file carries a stamp: the harness
  commit, a hash of the code it ran, tool versions, CPU and the load average.
  `results/summary.md` has all the tables. `results/caught/` holds the one
  mismatch the table caught while building, and `results/discarded/` a full
  run we did not use, with the reason.

## Results

Recorded on a Raspberry Pi 4 (4 cores, 1.5 GHz, 4 GB RAM), Node.js 24.22.1,
Cerbos 0.57.0, SpiceDB 1.57.0 with its in-memory datastore. Absolute numbers
from a Pi are slow; compare the designs with each other, not with your servers.

All three designs matched the 84-row table at every step, and gave the same
answer on every one of 60,000 timed checks that completed. Step 4 model, 10,000
documents, medians (`results/summary.md` has the rest):

| | if-statements | Cerbos | SpiceDB |
| --- | --- | --- | --- |
| One check, new triples, p50 / p99 | 0.14 / 0.24 ms | 3.83 / 7.91 ms | 10.8 / 19.4 ms |
| One check, 100 repeating triples, p50 | 0.14 ms | 3.77 ms | 2.83 ms |
| List, member (1,020 visible) | 4.4 ms | 31.6 ms (11.9 ms with an `IN` subquery) | 77 ms warm, 404 ms cold |
| List, admin (10,000 visible) | 25.3 ms | 29.9 ms | 691 ms warm, 3,279 ms cold |
| Lines changed, steps 1 to 4 | 29, 12, 20, 22 | 73, 82, 41, 15 | 133, 31, 10, 13 |

- A request to either engine that does no authorization work costs 2.4 ms at
  the median on this Pi (`results/final/floor.json`). Cerbos's own log puts its
  handling time at 0.63 ms.
- SpiceDB's cold lists got about 3.5 times slower at step 4, when the
  contractor exclusion arrived; warm lists did not change
  (`results/steps/step<N>-spicedb-list-cache.json`).
- With part of the late rule left out, each design fails open, and the
  table catches each of the three injected faults (`results/breaks.txt`).
- One of 60,000 SpiceDB checks failed with `UNAVAILABLE` (`REFUSED_STREAM`); it
  is counted, not timed.

## What this does not show

- SpiceDB ran on its in-memory datastore, which its docs describe as intended
  for testing. A Postgres or CockroachDB datastore will have different numbers.
- Everything ran on one Raspberry Pi. On this machine a request to either
  engine that does no authorization work already costs about 2.4 ms; see
  `results/final/floor.txt`. Everything, servers included, ran at `nice -n 19`
  on a Pi shared with other work, after waiting for a low load average.
- The app database is SQLite in the same process. With Postgres over a
  network, the if-statements and the Cerbos design pay a round trip per query.
- `sync.js` copies the whole database into SpiceDB at start. A real app has to
  write every change to SpiceDB as well as to its own database, which this repo
  does not implement or measure.
- Line counts depend on style. Read the diffs (`git show step4-ifs`, ...), not
  only the numbers.

## License

MIT
