# Architecture

## System boundaries

The project is a Next.js 16 App Router application. The active route preserves
the original client-side chat shell and uses a Server Action for OpenAI
requests. The repository also contains a server-side foundation for a future
persistent virtual workspace, but it is not mounted by the active route.

Commands run through `just-bash` over an in-memory filesystem rooted at
`/workspace`. The host filesystem and network are not exposed to commands.
When that foundation is wired into a future UI, workspace state is hydrated from
validated persisted nodes before each command, then snapshotted back into the
same transaction. A row lock serializes commands for one workspace; the
transcript request ID supplies an idempotency boundary.

## Components

- `src/app/` defines the root layout and route.
- `src/features/chat/components/chat-shell.tsx` owns the active chat UI,
  keyboard behavior, status announcements, and transcript viewport.
- `src/features/chat/actions.ts` validates messages and calls the OpenAI API.
- `src/features/shell/actions.ts` exposes the initialize and execute Server
  Actions and maps failures to safe user-facing results.
- `src/lib/auth/session.ts` provisions and verifies anonymous signed sessions.
- `src/lib/db/` defines the Drizzle schema and lazy PostgreSQL/Neon drivers.
- `src/lib/workspace-fs.ts` validates, hydrates, snapshots, and quotas virtual
  workspace nodes.
- `src/lib/workspaces/` reads and transactionally replaces workspace records.
- `src/test/` contains database-free unit/component tests plus an explicitly
  gated local-Postgres persistence test.

## Active request flow

1. The chat shell appends a submitted prompt to local React state.
2. It passes the conversation to `sendMessage`.
3. The action validates the conversation and requests a non-streaming OpenAI
   response.
4. The client renders the safe Markdown response or an accessible error.

## Future workspace foundation

`initializeShell` and `executeShellCommand` can provision an anonymous session,
load a workspace, execute `just-bash`, and persist the resulting filesystem and
command transcript. No active client component imports or invokes these actions
yet.

## Invariants and unavailable features

- `DATABASE_URL` and `SESSION_SECRET` are server-only configuration; no
  secret is sent to the browser.
- Workspace paths must remain under `/workspace`; node count, file size,
  command input, and command output are bounded.
- The active chat route has no database-backed conversation persistence.
- The workspace foundation has no active UI yet.
- There is no host filesystem access, arbitrary network access, Python or
  JavaScript command execution, account/profile UI, billing, rate limiting, or
  usage quota enforcement yet.
- Unit CI tests remain database-free. The separate integration job provisions a
  disposable Postgres service, pushes the schema explicitly, and uses only
  `TEST_DATABASE_URL`; no production Neon credentials are needed.
