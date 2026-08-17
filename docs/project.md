# Project

## Purpose

shell is a terminal-inspired interactive AI chat shell. The current model is a generic assistant that replies helpfully in the language of the visitor's latest message.

## Scope

The application currently contains one App Router page and one full-screen chat experience. It uses a neutral monochrome palette that follows the system light or dark preference. The empty state shows only the `$` prompt and a custom block cursor; there is no visible onboarding copy or input placeholder.

The interface supports multiline prompts, prompt history with the up and down arrow keys, submission with Enter, new lines with Shift+Enter, conversation clearing with Control/Command+L, pending and error states, and accessible status announcements. Clicking outside the textarea focuses the active prompt and moves the caret to its end.

It does not provide accounts, authentication, rate limits, a database, durable conversation history, analytics, or deployment infrastructure.

## Runtime Behavior

The browser holds the active messages and prompt history in React state. Each submission sends the complete active conversation to a Next.js Server Action. The action validates the messages and requests a non-streaming response from `gpt-5.6-luna`. Responses render as safe GitHub Flavored Markdown with a word-reveal animation; reduced-motion preferences disable the reveal.

## Boundaries

- Reloading or clearing the page loses the browser-held conversation.
- The application has no persistence layer.
- OpenAI requests set `store: false`; the application itself does not save request or response content.
- The OpenAI API key remains server-side and must be supplied as `OPENAI_API_KEY`.
- Application-specific knowledge is not implemented yet; do not present generic model answers as facts about shell.
- The current shell is a development chat experience, not a production-ready public service.
