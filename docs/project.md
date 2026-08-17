# Project

## Purpose

shell is a small, terminal-inspired web application for running commands in a
safe virtual workspace that survives page reloads. It gives each visitor an
anonymous signed session and a PostgreSQL-backed workspace.

## Current capabilities

The terminal supports common `just-bash` commands, multiline input, prompt
history, cwd changes, stdout/stderr and exit status, transcript history, clear
view, accessible pending/error announcements, bounded persistence, and
restoration after a reload. Commands execute in memory under `/workspace`;
each successful command advances a workspace revision.

## Intentionally unavailable

There is no host filesystem access, arbitrary network access, Python or
JavaScript execution, account/profile UI, billing, rate limiting, usage quotas,
or AI chat behavior on the terminal route. The older chat source remains
dormant and its `openai` dependency is retained because it still imports the
client. Unit CI remains database-free; a separate opt-in integration job uses
only a disposable `TEST_DATABASE_URL`.

## User and data boundaries

The browser holds only the active terminal presentation. Server Actions
authenticate the signed cookie, execute commands, and persist validated
workspace nodes and bounded transcripts. Clearing the viewport removes visible
history only; it does not delete the workspace. Reloading restores persisted
cwd, revision, files, and command history.
