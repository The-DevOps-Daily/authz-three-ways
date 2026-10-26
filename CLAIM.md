# Claim, written before any implementation or measurement

**Claim:** a single permission check is cheap in all three designs; what
separates them is listing what a user can see, and how many files change when
the fourth rule arrives.

## What would prove it wrong

Measured on the step 4 model with 10,000 documents:

1. Any design has a single-check p99 above 5 ms. Then a check is not cheap in
   all three.
2. For the typical member profile, the slowest "list what this user can see"
   is within 2x of the fastest. Then listing does not separate the designs.
3. Step 4 changes the same number of files in all three designs. Then the
   fourth rule does not separate them by files changed.

If 1 fails, the claim is wrong. If 2 and 3 both fail, the claim is wrong. If
only one of 2 or 3 fails, the post must say which half held.

## The four steps (the rules are fixed here, before any code exists)

Actions: `view`, `edit`, `delete`. One organisation.

1. **Roles.** Every user has one org role. `viewer` can view every document.
   `editor` can view and edit every document. `admin` can view, edit and
   delete every document.
2. **Teams.** Every document belongs to one team. A user belongs to zero or
   more teams. The `viewer` and `editor` roles now apply only to documents of
   the user's own teams. `admin` is unchanged.
3. **Sharing.** A document can be shared with one user as `view` or `edit`,
   whatever the user's teams are. A `view` share grants view. An `edit` share
   grants view and edit. A share never grants delete.
4. **The late rule: contractors cannot see documents outside their team.** A
   user flagged as a contractor gets no access (view, edit or delete) to a
   document whose team is not one of the contractor's teams. This overrides
   every grant from steps 1 to 3, including `admin` and shares.

## How each design is built

- `ifs`: plain functions in the application, reading SQLite. The list query is
  SQL.
- `cerbos`: Cerbos policy files, evaluated by a local Cerbos PDP. The app reads
  the principal and resource attributes from SQLite and sends them with every
  check. The list uses PlanResources and turns the plan into a SQL `WHERE`.
- `spicedb`: a SpiceDB schema and relationships, in SpiceDB's in-memory
  datastore. The app copies its data into relationships. The check is
  CheckPermission, the list is LookupResources.

Both engines are called over gRPC on 127.0.0.1 through their official Node
clients, one long-lived channel each, no TLS.

## Measurements decided up front

- Correctness: `fixture/expected.csv` gives the expected decision for every
  (user, action, document) in the fixture at every step, written by hand from
  the rules above. All three designs must match it at every step. A list must
  return exactly the documents the table says the user can view.
- Single check: random (user, action, document) triples from a seeded
  generated dataset, concurrency 1, warm-up first, the three designs
  interleaved so drift on the machine hits them equally. p50, p95, p99.
- List: "every document this user can view" for an admin, a typical member and
  a contractor, at 1,000 and 10,000 documents.
- Code-change cost: `git diff --numstat` of each design's commit at each step.
  Shared data-model changes go in a separate commit and are reported apart.
