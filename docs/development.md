# Development

## Prerequisites

- Node.js 20.9 or later, as required by the installed Next.js version
- npm
- An OpenAI API key for exercising chat requests

## Setup

Install the locked dependency graph and create a local environment file:

```bash
npm ci
cp .env.example .env.local
```

Set `OPENAI_API_KEY` in `.env.local`. Never commit a real key. Start the development server with `npm run dev` and open `http://localhost:3000`.

## Commands

| Command                | Purpose                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`          | Start the Turbopack development server                                       |
| `npm run build`        | Create a production build                                                    |
| `npm run start`        | Serve a completed production build                                           |
| `npm run format`       | Apply Prettier formatting and Tailwind class sorting                         |
| `npm run format:check` | Verify formatting                                                            |
| `npm run lint`         | Run Next.js ESLint rules and typed `@typescript-eslint/no-deprecated` checks |
| `npm run typecheck`    | Run TypeScript without output                                                |

## Verification

Run the same quality gates as continuous integration, in order:

```bash
npm run format:check
npm run lint
npm run typecheck
```

There is currently no automated test suite. For behavior changes, also verify the following in a browser:

- The empty full-screen shell follows the system light or dark preference and shows `$` with a block cursor, without visible onboarding or placeholder text.
- Enter submits, Shift+Enter adds a line, the arrow keys recall prompt history, and Control/Command+L clears the conversation.
- Clicking outside the textarea focuses the active prompt at its end.
- Pending and error states are announced, and the custom cursor remains usable for selection and input method composition.
- Responses reveal word by word, respect reduced-motion preferences, and render Markdown without raw HTML.
- Answers remain generic and language-aware; application-specific shell knowledge is not implemented.

## Conventions

- Preserve the App Router and feature-based chat boundary.
- Keep secrets and OpenAI calls on the server.
- Update canonical documentation when commands, behavior, or system boundaries change.
- Read the relevant versioned guide in `node_modules/next/dist/docs/` before changing Next.js APIs or conventions.
