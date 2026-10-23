# Decisions

## setup: entityParts
- `tech-stack` (spreadsheet): built = the row **Git** (key `Warstwa`) — git ≥ 2.38 / `merge-tree --write-tree` gate in the M28 git service, older git reported unsupported (shadow diff falls to `shadow-only`); context = all other rows (stack description, unchanged in the window). Why: the new row states a requirement the system detects and handles in code; the rest describes the stack.
- baseline (startMode resume): tests run only in env-runner, so the local baseline is `npm run build:envelopes && npm run build:server && npm run typecheck` — green at 597cde9f (main after 2.1.45, which passed its own env-runner system verification). The full env-runner suite runs once, at system verification.
- next-window gate: `2-1-46-to-2-1-47.md` is already pending (from_release = 2.1.46). Per the user's standing rule (one brief per PR) the gate is acknowledged: this brief is finished, PR'd and merged first; the next window follows in its own loop.
- Build overrides added to all four prompts at setup (empty `verifies`, retired criteria, `not yet`, removal without alias, read-only git primitives, static-verification cautions, dead code and performance are blocking) — carried over from the 2.1.44→2.1.45 loop.

## u1-release-marker/p1-l2 (implementer)
- "Najpierw historia HEAD, potem wszystkie refy poza cieniami; z trafień wygrywa najstarsze dodanie" built as two sequential searches (HEAD history; then `git log --exclude='refs/runs/*' --all`), the oldest add winning within the search that answered. The release file is immutable, so a marker appears in exactly one commit and the two readings coincide; the sequential form keeps the common case to one git subprocess. The second search never runs when HEAD already answers.
- The unrestricted `--all` search is gone (no flag, no fallback); `findFirstAdd` now takes the ref arguments, and the old `--all` tests were rewritten as `[ac:ac-resolvereleasecommit-uzywa-git-log-all]` (HEAD first, other branch, shadow-only → null) and `[ac:ac-przy-switchafterrelease-off-z-commitem-n]` (named target, switch off).
- M17's consumer (`resolveReignRef`) already falls back to SQLite on a `null` marker, so the M17 changes in this window need only its doc comment; the `isAncestorOfHead` gate and the delta core stay with u2/u3.
- `commitOnRelease` omits `switched` when it did not switch (additive field); the switch-off test reads absence as `false`.
