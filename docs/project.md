# Project

## Purpose

shell is a terminal-inspired AI chat application. Its original neutral shell
interface remains the active product experience. The repository also contains
the first server-side foundation for a future persistent virtual workspace.

## Current capabilities

The active UI supports multiline prompts, prompt history, Control/Command+L to
clear the conversation, accessible pending/error announcements, and safe
Markdown responses from the OpenAI chat action. It does not currently expose
the virtual workspace foundation.

## Intentionally unavailable

There is no visible interactive Bash interface, host filesystem access,
arbitrary network access, Python or JavaScript execution, account/profile UI,
billing, rate limiting, or usage quotas. Unit CI remains database-free; a
separate integration job uses only a disposable `TEST_DATABASE_URL`.

## User and data boundaries

The browser holds the active chat conversation. The future workspace foundation
keeps anonymous signed sessions, validated workspace nodes, bounded command
transcripts, and revisioned state on the server, but no active route invokes it
yet.
