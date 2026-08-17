# shell

An interactive, terminal-inspired virtual shell with a durable workspace. Each
visitor receives an anonymous signed session and a PostgreSQL-backed workspace;
commands execute inside `just-bash`, never on the host filesystem.

## Prerequisites

- Node.js 20.9 or later
- npm
- PostgreSQL (local) or a compatible Neon database

## Setup

```bash
npm run setup:local
```

The setup command installs dependencies, keeps any existing local values,
generates `SESSION_SECRET` when necessary, starts the local PostgreSQL service,
and pushes the Drizzle schema. It requires Docker or OrbStack to be running.
Keep `.env.local` private and never commit it.

Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command                    | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `npm run dev`              | Start the Next.js development server      |
| `npm run db:push`          | Push the Drizzle schema to `DATABASE_URL` |
| `npm run db:push:test`     | Push schema to `TEST_DATABASE_URL`        |
| `npm run build`            | Create a production build                 |
| `npm run start`            | Serve a completed production build        |
| `npm run format:check`     | Verify Prettier formatting                |
| `npm run lint`             | Run ESLint                                |
| `npm run typecheck`        | Check TypeScript without emitting files   |
| `npm run test`             | Run Vitest in watch mode                  |
| `npm run test:run`         | Run Vitest once (the CI command)          |
| `npm run test:integration` | Run opt-in PostgreSQL integration tests   |

See the [developer documentation](docs/index.md) for architecture, testing,
environment setup, and current boundaries.

## Current boundaries

The terminal supports common virtual-shell commands, multiline input, command
history, transcript clearing, persistent cwd/files, and restoration after a
reload. It intentionally does not provide host filesystem access, arbitrary
network access, a user account system, billing, or rate limits. Unit tests are
database-free; the opt-in integration suite requires a disposable
`TEST_DATABASE_URL`. The dormant chat source remains in the repository, but the
terminal path does not invoke OpenAI.

## License

[MIT](LICENSE)
