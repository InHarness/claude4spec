# Review u1-git-fetch-and-status — non-blocking findings (round 1)

- **rev-0001** `src/server/services/git.ts:197` — gitNetwork() always sets GIT_SSH_COMMAND (fallback `ssh`), overriding GIT_SSH (plink/wrapper), and appends `-o BatchMode=yes` to any configured command.
- **rev-0002** `src/server/services/git.ts:1322` — lastFetchedAt() not gated on `config.git.enabled` (ahead/behind are).
- **rev-0003** `src/server/services/git.ts:443` — no `git:status-changed` when the commit lands but switchAfterCommit fails.
- **rev-0004** `src/server/services/git.ts:225` — lock keyed by worktree root, not `--git-common-dir`; linked worktrees aren't serialized.
