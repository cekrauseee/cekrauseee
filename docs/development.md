# Development

## Prerequisites and environment

- Node.js 20.9 or later
- npm
- PostgreSQL locally, or a compatible Neon database

The quickest local setup uses the included PostgreSQL Compose service:

```bash
npm run setup:local
```

It installs dependencies, preserves existing `.env.local` values, generates a
session secret if needed, starts PostgreSQL, and pushes the schema. Docker or
OrbStack must be running. The database persists in the local `shell-postgres`
Docker volume.

`setup:local` writes these environment names to `.env.local`; values are
secrets or private connection details and must not be committed:

| Name             | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `DATABASE_URL`   | PostgreSQL/Neon connection used by Server Actions         |
| `SESSION_SECRET` | At least 32 characters for signing anonymous session JWTs |

Integration tests use a separate `TEST_DATABASE_URL` only. Point it at a
disposable local database; do not copy a production URL or rely on `.env.local`.

Use `npm run setup:local -- --skip-database` when dependencies and environment
setup are needed but PostgreSQL will be supplied separately. Use
`--skip-dependencies` to avoid running `npm ci` again.

## Database operator flow

`next build` does not open a database connection. The first browser request to
the shell does, so a database must be configured before exercising the app.

1. Set `DATABASE_URL` in the environment used by the command.
2. Run `npm run db:push` to apply the Drizzle schema to that database.
3. Start `npm run dev` (or `npm run build && npm run start`).
4. Open the app and run a command to provision an anonymous session/workspace.

`db:push` is an explicit operator action and is not run by CI. CI uses the
separate `db:push:test` flow against its disposable Postgres service; it never
requires production `DATABASE_URL` credentials.

## Commands and quality gates

| Command                    | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `npm run dev`              | Start the Turbopack development server  |
| `npm run db:push`          | Push the schema to `DATABASE_URL`       |
| `npm run db:push:test`     | Push the schema to `TEST_DATABASE_URL`  |
| `npm run build`            | Create a production build               |
| `npm run start`            | Serve a completed production build      |
| `npm run format:check`     | Verify Prettier formatting              |
| `npm run lint`             | Run ESLint                              |
| `npm run typecheck`        | Run TypeScript without output           |
| `npm run test`             | Run Vitest in watch mode                |
| `npm run test:run`         | Run Vitest once                         |
| `npm run test:integration` | Run opt-in PostgreSQL integration tests |

Run the CI sequence locally:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run db:push:test
npm run test:integration
npm run build
```

The first `npm run test:run` step is intentionally secret-free. The database
steps are explicit and require `TEST_DATABASE_URL`; CI provisions a disposable
Postgres service and never supplies production database credentials.

Read [Testing](testing.md) before adding coverage. For visual behavior, also
verify the terminal manually in a browser: command execution, multiline input,
prompt history, clear view, reload persistence, and offline/error states.

## Conventions

- Keep the App Router and feature-based boundaries.
- Keep cookies, database access, and command execution behind Server Actions.
- Treat workspace paths and command/output limits as security boundaries.
- Update canonical documentation when commands, behavior, or boundaries change.
- Read the versioned guide in `node_modules/next/dist/docs/` before changing
  Next.js APIs or conventions.
