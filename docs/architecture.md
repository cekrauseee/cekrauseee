# Architecture

## Overview

The project is a Next.js 16 App Router application. A Client Component owns the interactive terminal state, while a Server Action is the only path to the OpenAI API.

## Components

- `src/app/` defines the root layout, metadata, global styling, and the `/` route.
- `src/features/chat/components/chat-shell.tsx` owns the conversation, composer, keyboard controls, errors, and accessibility announcements.
- `src/features/chat/components/block-cursor-input.tsx` mirrors the textarea content to draw a caret-aware block cursor while retaining a native textarea for input.
- `src/features/chat/components/markdown-response.tsx` renders safe GitHub Flavored Markdown and applies the word-reveal presentation. Raw HTML is not enabled, and links opened in a new tab use `noopener` and `noreferrer`.
- `src/features/chat/hooks/` contains textarea sizing and in-memory prompt history behavior.
- `src/features/chat/actions.ts` validates messages and calls the OpenAI Responses API from the server.
- `src/lib/openai.ts` lazily creates and reuses the server-side OpenAI client.

## Data Flow

1. The visitor submits a prompt in the client shell.
2. The shell appends the user message to its local React state.
3. The shell passes the complete conversation to the `sendMessage` Server Action.
4. The action rejects malformed or incorrectly ordered messages.
5. The action calls `gpt-5.6-luna` with `store: false`, no tools, no streaming, and generic instructions to answer helpfully in the latest message's language.
6. The action returns plain result data. The client appends a successful answer or presents an error.
7. The Markdown renderer displays the answer. No application database or filesystem write occurs.

## Invariants

- `OPENAI_API_KEY` is a server-only secret and must never use a `NEXT_PUBLIC_` prefix.
- Only user and assistant roles cross the Server Action boundary, and the final submitted message must be from the user.
- The application does not persist conversations; browser state is the current source of truth.
- OpenAI response storage remains disabled with `store: false`.
- The current request contains no application-specific context or knowledge source about shell.
- Clearing the shell invalidates any in-flight response so it cannot repopulate the cleared conversation.
- Public deployment requires authentication, rate limiting, quotas, or equivalent abuse and cost controls not present in this repository.
