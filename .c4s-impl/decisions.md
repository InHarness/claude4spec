# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-09)

- Brief: `2-1-9-to-2-1-10-workflow.md` (app-spec / default, 2.1.9 → 2.1.10). 4 units, one per wave; empty stub ledger.
- Set-up answers reused from the previous run (brief 2-1-8-to-2-1-9-workflow-3), plan approved by the user.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification. `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only. `app: none`.
- Red baseline: skipped (no local suite run is possible); the env-runner run at the end is baseline + final check together. Failures claimed "pre-existing" are proven against an env built from `main`. One fix round after the env-runner run is budgeted up front.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged, followed by full cleanup.
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded).
- No user-jobs table in the spec (the module table in SKILL.md §13 stands in for the system verifier) → no `units[].jobs`.

## Overrides of the skill (lessons from the previous run)

- An active `ac` with an empty `verifies` is not a read problem / clarification: it checks its own title and description against its unit's pages (written into the implementer/verifier prompts as "Build overrides").
- A unit's FIRST review (`rounds.review == 0`) reads `baseCommit..HEAD`, not `startCommit..HEAD` — a verifier reopen moves `startCommit`, and the first review would otherwise see only the fix.
- UI criteria (u3, u4) are proven by frontend unit tests (vitest + jsdom), `observedIn: unit`.

## Entity types (versions checked against `c4s catalog` at set-up)

| type | role | checks | links | inactive | v |
| --- | --- | --- | --- | --- | --- |
| ac | criteria (observedIn unit) | verifies | verifies | status = deprecated | 3 |
| endpoint | built | | linkedDtos[].dto | | 3 |
| dto | built | | | | 2 |
| module-dependency | context | | | | 1 |
- Next window: `2-1-10-to-2-1-11.md` already exists; acknowledged in the approved plan — the loop does not stop on it.

## u2-git-sync-head-change (implementer, p1-l4-l10)

- **Merge without an intermediate state.** `sync()` decides conflicts with `git merge-tree --write-tree` (in memory, git ≥ 2.38), builds the merge commit off-tree with `git commit-tree <tree> -p HEAD -p <upstream>`, and moves HEAD onto it with `git merge --ff-only`. A refusal at any step leaves HEAD, index and working tree untouched — no `MERGE_HEAD`, no conflict markers. The fast-forward uses the same `git merge --ff-only`; git's own "would be overwritten" refusal (tracked or untracked) is mapped to `dirty-blocked` with the paths git lists, after a deterministic pre-check that computes the same collisions from `git diff HEAD <upstream>` ∩ (tracked changes ∪ untracked files).
- **Origin labelling (M40 j37qjvvh).** `GitService` takes an optional `markHeadChangeOrigin(absPaths)`; `buildProjectContext` passes `headChangeOriginMarker(w, …)` (`src/server/fs/head-change-origin.ts`) over THIS context instance's registry-root mounts. Labels are set before HEAD moves (the contract) and set again right after the git command, still before the reload: an M40 label lives 600 ms from `markOrigin` and is resolved at event arrival, so the re-label keeps a slow provider's late events labelled. Same sequence in `checkout()` (diff `HEAD..refs/heads/<branch>`).
- **Reload.** The route keeps the reload (renamed `onSwitched` → `onHeadChanged`, wired to `onContextConfigChanged` = `cache.invalidate`), called on checkout `switched` and sync `fast-forwarded`/`merged` after gitService has emitted `git:status-changed { headChanged: true }` and before the response — order label → HEAD → event → reload.
- **Events on other results.** Literal reading of M28 wyfi1e4o: every sync result except `skipped` and `no-upstream` emits `headChanged: false` (including `busy` on a taken lock — harmless, the client only refetches status).
- `paths` are repository-relative (git's form), as in the DTO examples. `busy` carries `message: null` (DTO: `message` only on `error`).
- The "entities match the new HEAD" criteria are proven with the real `ProjectContextCache` and a builder that reads the entity file at build time, plus a source assertion that production wires `onHeadChanged → onContextConfigChanged → cache.invalidate`: a full `buildProjectContext` in a unit test needs the whole workspace/plugin runtime.

## u3-header-fetch-sync-ui (implementer, p1-l5-l10)

- **Own op vs. another client's.** The server order is event → context reload (`project:disposed`) → response, so the initiating tab may be reloaded by `project:disposed` before its response arrives. `state/gitOps.ts` records this client's in-flight git op; the WS handler reloads only when no own sync/checkout is in flight. An own sync's `headChanged` event parks "Updated from the remote" in sessionStorage first, so the toast survives whichever reload comes first. The mark of a HEAD-moving sync/checkout is not cleared (the page reloads).
- **Focus refetch** is an own listener in `useGitStatus` (window `focus` + `visibilitychange` → `refetchQueries(active, cancelRefetch: false)`), not React Query's `refetchOnWindowFocus`: the app disables it globally and RQ v5 only watches `visibilitychange`, missing an app switch with the tab visible.
- **Reload = `window.location.reload()`** behind `lib/project-reload.ts` (same as the existing checkout / `project:disposed` path); tests mock that module.
- **Checkout states aligned with 846dmtbu:** `dirty-blocked` → hint in the branch list ("Commit or stash your changes before switching branches"), `busy` → hint at the entry, `not-found` → warning "Branch no longer exists" (were toasts with the server message).
- **Frontend tests run in happy-dom** (`// @vitest-environment happy-dom`), the repo's existing DOM environment; jsdom / Testing Library are not installed. Rendering via `react-dom/client` + `act`, as the other client render tests.
- **Counts pluralised** ("1 new commit on the remote", "1 file") — the spec's `{N} new commits` / `{N} files` read for N ≠ 1.
- Fixed the `WsEvent` `git:status-changed` comment in `src/shared/types.ts` (u2 review rev-0001): event first, then context reload.
