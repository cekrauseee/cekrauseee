# Architecture

## System boundaries

The project is a Next.js 16 App Router application. The browser owns terminal
input and transcript presentation. Server Actions own session lookup,
validation, database transactions, and virtual command execution. PostgreSQL
stores only the anonymous identity/session records, workspace nodes, cwd and
revision, and bounded command transcripts.

Commands run through `just-bash` over an in-memory filesystem rooted at
`/workspace`. The host filesystem and network are not exposed to commands.
Workspace state is hydrated from validated persisted nodes before each command,
then snapshotted back into the same transaction. A row lock serializes commands
for one workspace; the transcript request ID supplies an idempotency boundary.

## Components

- `src/app/` defines the root layout and route.
- `src/features/terminal/components/terminal-shell.tsx` owns the client UI,
  keyboard behavior, status announcements, and transcript viewport.
- `src/features/shell/actions.ts` exposes the initialize and execute Server
  Actions and maps failures to safe user-facing results.
- `src/lib/auth/session.ts` provisions and verifies anonymous signed sessions.
- `src/lib/db/` defines the Drizzle schema and lazy PostgreSQL/Neon drivers.
- `src/lib/workspace-fs.ts` validates, hydrates, snapshots, and quotas virtual
  workspace nodes.
- `src/lib/workspaces/` reads and transactionally replaces workspace records.
- `src/test/` contains database-free unit/component tests plus an explicitly
  gated local-Postgres persistence test.

## Request flow

1. The terminal mounts and calls `initializeShell`.
2. The action authenticates the `__Host-shell_session` cookie or provisions an
   anonymous user, session, and default workspace.
3. The action returns cwd, revision, and bounded transcript history.
4. A submitted command is validated, then runs inside a database transaction
   that locks the workspace row.
5. The action restores the virtual filesystem, executes `just-bash`, snapshots
   nodes, writes the transcript, advances the revision, and returns output.
6. The client renders stdout/stderr, exit status, cwd, and an accessible status
   announcement. Clear view removes only the visible transcript.

## Invariants and unavailable features

- `DATABASE_URL` and `SESSION_SECRET` are server-only configuration; no
  secret is sent to the browser.
- Workspace paths must remain under `/workspace`; node count, file size,
  command input, and command output are bounded.
- A terminal reload restores workspace data and bounded command history.
- Clear view does not delete persisted workspace data.
- There is no host filesystem access, arbitrary network access, Python or
  JavaScript command execution, account/profile UI, billing, rate limiting, or
  usage quota enforcement yet.
- The dormant chat source still imports `openai`, but the terminal route does
  not call it and does not provide an AI chat feature.
- Unit CI tests remain database-free. The separate integration job provisions a
  disposable Postgres service, pushes the schema explicitly, and uses only
  `TEST_DATABASE_URL`; no production Neon credentials are needed.
