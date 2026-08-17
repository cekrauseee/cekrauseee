# Project

## Purpose

shell is a terminal-inspired virtual shell. Its original neutral interface is
preserved while its prompt executes commands in a persistent virtual workspace.

## Current capabilities

The active UI supports multiline commands, persisted prompt history,
Control/Command+L to clear the visible transcript, and accessible
pending/error announcements. Commands run with `just-bash` against an isolated
filesystem and are persisted with the current working directory and transcript.

## Intentionally unavailable

There is no host filesystem access, arbitrary network access, Python or
JavaScript execution, account/profile UI, billing, rate limiting, or usage
quotas. Unit CI remains database-free; a separate integration job uses only a
disposable `TEST_DATABASE_URL`.

## User and data boundaries

The browser displays the active transcript. Anonymous signed sessions,
validated workspace nodes, bounded command transcripts, and revisioned state
remain on the server and are loaded whenever the interface initializes.
