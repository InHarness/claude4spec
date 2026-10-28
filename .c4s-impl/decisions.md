# Decisions

## Setup (2026-10-28)

- `ask` rows of defaults.md answered from the previous brief (2.1.56→2.1.57): tests only in env-runner (whole suite at system verification), filtered = static read + `npm run typecheck`; waiting recipient = the user in this Claude Code session. Plan approved by the user.
- User jobs: the modules-table convention (pages/SKILL.md §12 `45yst8co`, table = spreadsheet `moduly-feature` in §13) is a module index without a user-jobs column → no unit owns a job; the system verifier works from goals, criteria and built entities.
- entityParts `flagi-cli-m01` (spreadsheet): part `built` — rows 2–9, key column 'Flag' (each flag the start CLI registers: default + destination); part `context` — column 'Opis' (behaviour stated by the unit's ACs). Why: the rows are the flags the start process registers.
- New entity type roles this window: `ac` criteria (checks `verifies`, observedIn unit, inactive status = deprecated); `cli-command` built (src/bin/c4s/commands/<name>.ts); `ui-view` built (router + page component); `spreadsheet` per-entity.
- 2026-10-28 (orchestrator): baseline — `npm run typecheck` zielony na e95b56fc (merge #308, system-verified 2.1.57); pełny suite tylko w env-runnerze, przy weryfikacji systemu.
- 2026-10-28 (orchestrator): brama „next window exists” (`2-1-58-to-2-1-60.md` pending) rozstrzygnięta stałą regułą użytkownika „jeden brief na PR”: kończymy ten brief, PR+merge, następny brief potem.
- 2026-10-28 (orchestrator): dev-0201 (lazy-project-activation read problem) wycofany — literówka orkiestratora w state.json (`…-np-sche` zamiast `…-np-schem`); slug poprawiony, wszystkie slugi i anchory recept sprawdzone z briefem, split powtórzony.
- 2026-10-28 (orchestrator): `## This build` w promptach — usunięta adnotacja „ProjectSwitcher.tsx (removed)” (przesądzała dev-0701); teraz decydują strony przy `<to>`.

## workspace-home-model / p1-l1-l2 (implementer)

- View = `WorkspaceRegistry` read API (`getWorkspace`/`listWorkspaces`/`getProject`/…) composing the stored entry with `workspace.json`; the home file is read once per registry instance and cached (outside change → next start), own writes (`registerProject`, `removeProject`) refresh the cache. `startServer` calls `registry.openView(name)` before listen: `.gitignore` (`local/`) + validation → `WorkspaceFileError` with code refuses the start. Persisted entry type `StoredWorkspaceRecord` (home entries carry `home` + `projectTrust`, no `projects`/`plugins`).
- Trust of a home project: `projectTrust[id] = { path, trustProjectPlugins?, trustSpecSkillHooks? }` in the registry entry; the view folds flags in only while `path` equals the view path, so a moved id reads as undecided (prompt again). Setting a flag under a new path replaces the record (no stale consent survives).
- Slots: M31 owns `slotsDir(ws)` / `slotDir(ws,id)` / `prepareSlot` (continuity + quarantine for home kind); M41 `openDb(slotDir)` / `forgetDbSlot(slotDir)` take the directory from the caller; free `slotDirFor` removed (it ignored the registry home).
- Advisory lock + atomic write extracted to `advisory-lock.ts`, shared by the registry and `workspace.json` (lock in `local/`).
- Out of this unit (left to their units): creating a home entry from `--cwd`, plugin package location (`node_modules` in slots dir), CLI listing of kind/home, activation refusing a dir carrying `workspace.json`. `lastOpenedProject` is written by `touchLastOpened` (both kinds); no reader in this unit.

## workspace-home-model / p1-l1-l2 round 2 (implementer)

- rev-0001: `migrateLegacyDbIfNeeded` scans `registry.listSlotsDirs()` (stored entries only, no workspace.json read). The view (`compose`) no longer throws on a broken home file: the entry reads with `projects: []`, `plugins: []`, `fileError {code, message}`; the failed read is cached like a good one. Strict reads remain `openView` (start) and writes into the file (`setTrustFlag`, mutateWorkspaceFile). Listing/resolution behaviour → dev-0103 (non-blocking, ASSUMPTION).
- rev-0002: `registerProject` / `removeProject` / `setTrustFlag` take the kind from `ws.home`; the home registration returns the project from the caller's view (or `{id, cwd}` for a fresh one) instead of re-reading the entry.
- rev-0003: new `selectOrCreateEntry` (stored entry, no compose); `startServer` uses it, so `openView` is the single eager read of workspace.json, after `ensureHomeGitignore`; `openView` reuses a read this instance already made. `selectOrCreate` = compose(selectOrCreateEntry) for the launcher/CLI.

## workspace-home-model / p1-l1-l2 round 3 (implementer)

- rev-0004: the real start path now owns the single read. `src/bin/launch.ts` `prepareStart(registry, args, network)` is the launcher's whole pre-listen sequence (the bin runs it, then `startServer(prepared.options)`): `openStartWorkspace` = `selectOrCreateEntry` → network flags on the stored entry (`setNetwork` now returns the stored entry, `applyNetworkFlags` is generic and composes nothing) → `openView` (`.gitignore`, then the strict read). Create-project then bootstraps on that view. `startServer` takes the launcher's `registry` + `workspace` (view) + `initialProject` (required; `createProject`, its own `new WorkspaceRegistry()`, `migrateIfNeeded`, `selectOrCreateEntry` fallback, re-registration and legacy-db move removed — the bin/bootstrap already did them). `workspaceOnlyLaunch` replaced by `openStartWorkspace`.
- Home registration of a path this process's view already lists writes nothing and so does not re-read `workspace.json` (process-lifetime view). A NEW project's registration still reads the file under its lock — that is the read-modify-write, not a second view read; the test `[section:ssn335r8]` in `src/bin/launch.test.ts` pins both cases (reads `[true]` / `[true, true]`, every one after `.gitignore`).
