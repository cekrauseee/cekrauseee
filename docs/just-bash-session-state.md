# just-bash session-state dependency

The shell uses the public
[`cekrauseee/just-bash`](https://github.com/cekrauseee/just-bash) fork based on
upstream `just-bash@3.3.0`.

The dependency resolves to the immutable `just-bash-3.3.0.tgz` asset from the
[`session-state-v2`](https://github.com/cekrauseee/just-bash/releases/tag/session-state-v2)
GitHub release. Its SHA-256 is
`c191f462f3fc72ac6d3029444f1dd0bc87886de6d5852b90b6fd5a34213c1e11`.
The app does not patch `node_modules` during installation and does not depend
on unpublished local files.

The fork adds:

- `BashOptions.sessionState`, disabled by default;
- `snapshotState()` and `restoreState()` for versioned JSON-safe state;
- top-level state commits without changing nested-shell isolation; and
- runtime shape validation and defensive cloning.

The immutable fork release adds stateful synchronous `fc`, `umask`, and
virtual `ulimit` builtins. Their state is part of the session-state-v2 snapshot:

- `history` retains at most 1,000 commands of at most 16 KiB each;
- `umask` controls newly created virtual files and directories while rewrites
  preserve existing modes; and
- `ulimits` stores deterministic shell-visible values without constraining the
  host process.

Snapshots created before those optional fields existed remain valid. Restore
supplies the default mask, limits, and empty history when the fields are absent.

The app adds a stricter storage boundary around the engine snapshot. It
enforces aggregate byte and entry limits, normalizes paths to `/workspace`,
preserves the fork's file-descriptor table (including input markers, alias
groups, shared offsets, closed standard descriptors, and the next descriptor
counter), and stores shell state atomically with the filesystem, cwd,
transcript, and revision.

Background execution, `jobs`, `wait`, `kill`, signals, process substitutions,
and all asynchronous execution remain outside the runtime contract. The
interactive editor workflow of `fc` is also excluded; the virtual builtin
supports synchronous listing, ranges, reversal, and `-s` substitution.

## Release integration status

`package.json` and `package-lock.json` resolve the published
`session-state-v2` asset directly. The installed package is covered by tests
for `fc`, `umask`, `ulimit`, history, and the descriptor snapshot fields.
