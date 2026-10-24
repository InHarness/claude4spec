# Decisions

## setup
- entityTypes carried over from the 2.1.45→2.1.46 loop (catalog payload versions unchanged); new type `database-table` (v3, recipe of u1: `spec-release`) classified `built` — a SQL migration + mapping, verified by a migration test next to it. No `per-entity` types in the recipes → no entityParts.
- conventions: the user-jobs line named `pages/SKILL.md` section 12 (`45yst8co`) = the heading "Moduly"; the table is section 13 (`oq23nb0j`, spreadsheet `moduly-feature`) — the known off-by-one of brief section offsets. It is the module index, not a user-jobs table: no unit owns a job (`jobs: []`), as in 2.1.46.
- recipe ranges given as several disjoint ranges ("sections 9, 11", "0, 2–4", context "1–2, 8–10, 13") are split into several page reads of the same key, each with one range; `deferred`/`completes` stay on the read that carries the change range.
- release.json: the `ask` rows answered as in 2.1.46 (approved plan): tests only in env-runner (full `npm test` + `npm run test:e2e` once, at system verification), filtered = static reading + `npm run typecheck`, waiting recipient = the user in this session. startMode `resume` (delta window).
- Build overrides carried over to all four prompts (empty `verifies`, retired criteria, `not yet`, removal without alias, static-verification cautions, dead code and performance blocking); added: rollback of accept-shadow is proven against a real repo + DB, lock/mutex released on every path.
