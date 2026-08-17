# Architecture

## System boundaries

The project is a Next.js 16 App Router application. The active route preserves
the original client-side terminal interface and connects it to a persistent
virtual workspace through Server Actions.

Commands run through `just-bash` over an in-memory filesystem rooted at
`/workspace`. The host filesystem and network are not exposed to commands.
Workspace state is hydrated from validated persisted nodes before each command,
then snapshotted back into the same transaction. A row lock serializes commands
for one workspace; the transcript request ID supplies an idempotency boundary.

## Components

- `src/app/` defines the root layout and route.
- `src/features/shell/components/shell-terminal.tsx` preserves the active terminal
  UI, keyboard behavior, status announcements, and transcript viewport.
- `src/features/shell/actions.ts` exposes the initialize and execute Server
  Actions and maps failures to safe user-facing results.
- `src/lib/auth/session.ts` provisions and verifies anonymous signed sessions.
- `src/lib/db/` defines the Drizzle schema and lazy PostgreSQL/Neon drivers.
- `src/lib/workspace-fs.ts` validates, hydrates, snapshots, and quotas virtual
  workspace nodes.
- `src/lib/shell-state.ts` validates, bounds, and serializes the versioned
  interpreter snapshot before it crosses the database boundary.
- `src/lib/shell-engine.ts` restores the virtual filesystem and interpreter
  state, executes one synchronous command, and produces the next snapshot.
- `src/features/shell/transaction.ts` serializes one workspace command and
  commits filesystem, interpreter state, cwd, transcript, and revision
  atomically.
- `src/lib/workspaces/` reads and transactionally replaces workspace records.
- `src/test/` contains database-free unit/component tests plus an explicitly
  gated local-Postgres persistence test.

## Active request flow

1. The shell initializes an anonymous session and restores the persisted
   transcript and prompt history.
2. The client submits each command with a unique request ID to
   `executeShellCommand`.
3. The action validates the command, hydrates the virtual filesystem, executes
   it with `just-bash`, and persists the filesystem and interpreter snapshots,
   cwd, and transcript in one transaction.
4. The client renders plain command output or an accessible error.

## Invariants and unavailable features

- `DATABASE_URL` and `SESSION_SECRET` are server-only configuration; no
  secret is sent to the browser.
- Workspace paths must remain under `/workspace`; node count, file size,
  command input, command output, descriptor state, resource-limit state, and
  command history are bounded.
- Background execution, job control, signals, process substitution, and all
  asynchronous execution are rejected before interpreter execution.
- There is no host filesystem access, arbitrary network access, Python or
  JavaScript command execution, account/profile UI, billing, rate limiting, or
  usage quota enforcement yet.
- Unit CI tests remain database-free. The separate integration job provisions a
  disposable Postgres service, pushes the schema explicitly, and uses only
  `TEST_DATABASE_URL`; no production Neon credentials are needed.
