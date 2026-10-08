# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-08)

- Brief: `2-1-8-to-2-1-9-workflow-3.md` (app-spec / default, 2.1.8 → 2.1.9). Only this brief is implemented; the other two 2.1.8→2.1.9 briefs are ignored (the user deletes them). Only workflow-3 will be marked implemented.
- `c4s get-brief` truncates this brief at the response budget; it was read whole with `--range`.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification. `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only.
- Red baseline: skipped (no local suite run is possible under the rule above); the env-runner run at the end is the baseline + final check together. Failures there claimed "pre-existing" are proven against an env built from `main`.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- Next-window gate acknowledged up front: briefs 2.1.9→2.1.10 and 2.1.10→2.1.11 already exist; the loop does not stop on them.
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged (user decision), followed by full cleanup.
- `package.json` stays at 2.1.11 (to_release 2.1.9 would be a downgrade).
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded by pathspec).

## Entity types (user-confirmed)

| type | role | checks | links | inactive | v |
| --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | verifies | status = deprecated | 3 |
| mcp-tool | built | | | | 1 |
| endpoint | built | | linkedDtos[].dto | | 3 |
| dto | built | | | | 2 |
| code-snippet | built | | | | 1 |
| spreadsheet | per-entity (each sheet classified from its content) | | | | 3 |
| module-dependency | context | | | | 1 |

## Entity parts (spreadsheets, classified at 2.1.9)

- `wklad-do-edytora-m05` — built, all data rows, key `Nazwa`: rows are editor contributions M05 registers.
- `wklad-do-edytora-m20` — built, all data rows, key `Nazwa`: rows are TipTap extensions M20 registers.
- `wklad-do-edytora-m52` — built, row `spec-skills`, key `Nazwa`: the command source M52 registers in `chat-input`.
- `znaczniki-xml-m52` — built, row `skill_ref`, key `Znacznik`: the XML tag M52 registers.
- `katalog-operacji-m52` — built, all data rows, key = operation name: L3 operation catalog entries; rows land per unit (`update_skill_file` u07, `list_exposed_projects` u11, `fork_writing_style` u12).
