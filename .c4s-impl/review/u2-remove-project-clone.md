# u2-remove-project-clone — non-blocking review findings

- **rev-0001** (`src/bin/launch.ts:113`): `--clone <slug>` is now silently ignored like any unknown flag — an old command lands on a workspace-only start (/welcome) with no hint the flag was removed. Optional: a one-line "removed flag --clone ignored" warning (not an alias). The parser has no unknown-flag handling at all, so not a regression. Would change what a user observes → needs a spec decision before building.
