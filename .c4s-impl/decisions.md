# Decisions

- setup: the brief's `criteria:` recipe lines are entities of type `ac` (the only `criteria`-role type in the catalog); state.json records them as `ac`.
- setup: non-contiguous section ranges in a recipe read (`sections 0–11, 13–14`, `sections 1–2, 4`) are recorded as several page entries with the same key, one range each.
- setup (user): no tests run during the loop. Portion and unit verification is static (test bodies read, `npm run typecheck` as the only command); the full suite + e2e run once, at system verification, in an env-runner environment. The red-baseline check of startMode resume is therefore skipped.
- setup (user): the loop continues on the existing worktree and branch `brief/2-1-7-to-2-1-8` (PR #258) instead of a fresh `impl/…` branch; at done both `2-1-7-to-2-1-8-workflow-test.md` and `2-1-7-to-2-1-8.md` are marked implemented.
- loop (user): the always-on "next window exists" gate (briefs from 2.1.8 exist) is acknowledged up front — the user started this window knowingly; it does not stop the loop.
- loop: an active criterion with empty `verifies` is not a blocking read problem in this build (39 of them across 11 units; the window is pinned, so blocking would stall every unit). Verified against its title, placed by the layer its title concerns; reported once as dev-0001.
