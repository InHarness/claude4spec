# System verification — env-runner evidence (2-1-48-to-2-1-49)

- r1 @ eaa32c89 (app image built at create from this sha): npm run typecheck exit 0; npm test 1 failed / 6874 — tests/integration/api/sync-merge-entity-version.test.ts (u4 test waited on chokidar delivery) → fixed in 04d74334 (test + harness only).
- r1 full e2e: 4 failed tests / 200 passed / 19 skipped — seed-only files as on 2.1.48 (artifact-threads-panel, entity-version-history, plan-footer, envelope-entity-pages "seed one first"), editor-l8 'root kind', ac-envelope '/ac is offered once'.
- r2 @ 04d74334 (only tests changed since create; app runtime = create image @ eaa32c89, r2-runtime-diff confirms): npm test 6875/6875; sync-merge-entity-version.test.ts 3/3 isolated green; ac-envelope.test.ts 3/3 isolated green (r1 failure = flake); editor-l8-contexts.test.ts 'root kind' 2/3 isolated red — same rate as on main (2-1-47-main-l8 @ 5219cb24, 2/3 red, measured in the previous window); the branch touches no editor/L8 code → pre-existing.
- Logs: /Users/michael/Code/ctowiec/claude4spec-private/env-runner/envs/2-1-48-to-2-1-49.* (r1) and 2-1-48-to-2-1-49.r2-* (r2).
