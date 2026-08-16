# cekrauseee

A terminal-style AI chat shell built with Next.js and the OpenAI Responses API. It is the foundation for a future conversational portfolio; the current assistant has no personal knowledge about cekrauseee.

## Prerequisites

- Node.js 20.9 or later
- npm
- An OpenAI API key

## Setup

```bash
npm ci
cp .env.example .env.local
```

Set `OPENAI_API_KEY` in `.env.local`, then start the application:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command                | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | Start the development server                   |
| `npm run build`        | Create a production build                      |
| `npm run start`        | Serve a production build                       |
| `npm run format`       | Format supported files                         |
| `npm run format:check` | Check formatting without changes               |
| `npm run lint`         | Run ESLint, including typed deprecation checks |
| `npm run typecheck`    | Check TypeScript without emitting files        |

The current shell has no authentication, rate limiting, or usage quotas. Do not expose it publicly as a production service without abuse protection and cost controls.

Read the [developer documentation](docs/index.md), starting with the [architecture](docs/architecture.md) for runtime boundaries and data flow.

## License

[MIT](LICENSE)
