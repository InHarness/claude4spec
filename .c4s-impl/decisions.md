# Decisions

## Setup (2026-10-28)

- `ask` rows of defaults.md answered from the previous brief (2.1.56→2.1.57): tests only in env-runner (whole suite at system verification), filtered = static read + `npm run typecheck`; waiting recipient = the user in this Claude Code session. Plan approved by the user.
- User jobs: the modules-table convention (pages/SKILL.md §12 `45yst8co`, table = spreadsheet `moduly-feature` in §13) is a module index without a user-jobs column → no unit owns a job; the system verifier works from goals, criteria and built entities.
- entityParts `flagi-cli-m01` (spreadsheet): part `built` — rows 2–9, key column 'Flag' (each flag the start CLI registers: default + destination); part `context` — column 'Opis' (behaviour stated by the unit's ACs). Why: the rows are the flags the start process registers.
- New entity type roles this window: `ac` criteria (checks `verifies`, observedIn unit, inactive status = deprecated); `cli-command` built (src/bin/c4s/commands/<name>.ts); `ui-view` built (router + page component); `spreadsheet` per-entity.
