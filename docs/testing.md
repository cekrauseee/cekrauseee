# Testing

The suite uses Vitest, React Testing Library, and jsdom. It is deliberately
small and behavior-focused:

- `workspace-fs.test.ts` exercises persistence hydration, deterministic
  snapshots, symlinks, root requirements, and quota/path/content validation.
- `terminal-shell.test.tsx` mocks the Server Actions and covers bootstrap,
  successful submission, action errors, and clearing the visible viewport.
- `integration/workspace-persistence.test.ts` commits a real local-pg Drizzle
  transaction and verifies persisted workspace state.

Run the unit suite once with `npm run test:run`, or use `npm run test` while
developing. Both are deterministic and require no database.

## Opt-in PostgreSQL integration

The separate integration run exercises the production local `pg` driver and a
real Drizzle transaction. It requires a disposable database URL under the
dedicated `TEST_DATABASE_URL` name:

```bash
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shell_test
npm run db:push:test
npm run test:integration
```

The test command refuses to run without `TEST_DATABASE_URL`. It maps that value
to the production driver's `DATABASE_URL` internally; it never reads or uses a
local/prod `DATABASE_URL`. CI starts a disposable Postgres service, pushes the
schema explicitly, then runs integration tests after the unit suite.

## No overtesting

Test user-visible behavior and high-risk pure logic, not implementation details.
Prefer a few assertions that prove a meaningful workflow over line coverage,
snapshots, or tests for every branch of trivial JSX. Keep database, network, and
real Server Action integration out of the fast unit suite; the explicit
PostgreSQL layer has its own provisioned `TEST_DATABASE_URL`.

When adding a test, ask:

1. Does it protect a user-visible capability or a security/data invariant?
2. Can it run deterministically without a live database or external service?
3. Will it fail for a meaningful regression rather than a harmless markup refactor?

If the answer is no, do not add the test here. Browser end-to-end coverage is a
separate future layer for deployment-level behavior.
