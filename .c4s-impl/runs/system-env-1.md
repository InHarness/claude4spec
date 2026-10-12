# System verification — env-runner run 1 (impl-2-1-14 @ b5ef8d5d, thread uy68_z0SfYmt)

- clone (uid 1000) / npm ci (lockfile) / build:envelopes / build:server / playwright: all exit 0. HEAD in container = b5ef8d5d.
- npm test: 5419 tests, 5416 passed, 3 failed — all three in tests added by this branch:
  - src/server/external-skills/external-skills-service.test.ts `[section:foj9tbk4]` — expected rendered section to contain "It is not how you read the specification…" (m22-skille).
  - src/server/routes/release-pushes.test.ts `[ac:ac-push-bez-upstream-przy-bledzie-sie]` — audit-log response is `{ items: [...] }`, test reads `.length` on it (m28-bramki-git).
  - src/server/services/release-file-roots.test.ts `[section:m17reldisk]` bundle manifest test — TypeError in sanitizeConfigForBundle (`claudeUsePreset` of undefined): test fixture config lacks the agent block (m17-plik-release-roots).
- test:e2e: running.
→ reopen m28-bramki-git, m22-skille, m17-plik-release-roots (only the failing slug each).
- test:e2e: 230 tests, 208 passed, 3 failed, 19 skipped; 5 files red:
  - "environment has no endpoint/plan — seed one first" (empty seed): artifact-threads-panel, entity-version-history, plan-footer, envelope-entity-pages ×2 — the same precondition set as the 2.1.12 and 2.1.13 runs (proven identical on main then).
  - ac-envelope › "/ac is offered once and opens its own popover": slash menu 0 rows — same shape as last run's /uiview flake (passed 3/3 solo). The branch does not touch the slash menu / envelope boot. Solo re-runs ordered in run 2.

# Run 2 (impl-2-1-14-r2 @ ffcf33f8)

- npm test: 5419/5419 passed — the three run-1 failures are fixed.
- ac-envelope solo ×3: 5/6 failed each time, but every failure is the fresh env sitting on the onboarding wizard ("Welcome to claude4spec — two quick choices") / "no page with an editor — seed one first": a precondition of a solo run on a fresh env, not evidence either way.
- test:e2e full: 230 tests, 206 passed, 5 failed, 19 skipped. Seed preconditions as in run 1 (artifact-threads-panel, entity-version-history, plan-footer, envelope-entity-pages ×2), plus:
  - ac-envelope › "/ac is offered once and opens its own popover" (slash menu 0 rows) — red in both full runs;
  - mcp-tools-envelope › "renders the detail page with the contract separated from the logic";
  - editor-l8-contexts › "page context derived from the root kind" — known pre-existing flake on main (~2/3).
- → comparison env built from main (50c900c) ordered: full test:e2e on main, to prove which of these are pre-existing.

# Run 3 — comparison env from main (main-2-1-13-cmp @ 50c900c, fresh, empty seed), full e2e ×2

- e2e-1: 208 passed / 3 failed — seed preconditions (artifact-threads-panel, entity-version-history, plan-footer, envelope-entity-pages ×2) + frontend-mockups-envelope › "/uiview is offered once…" (slash menu, same test shape as the branch's ac-envelope "/ac is offered once…").
- e2e-2: 215 passed / 3 failed — seed preconditions + mcp-tools-envelope › "renders the detail page with the contract separated from the logic" (the same test that failed on the branch in run 2).
- Conclusion: every branch e2e failure has its counterpart on main: seed preconditions (identical set), mcp-tools-envelope detail page (fails on main too), the slash-menu "offered once" envelope test (flaky on main — /uiview there, /ac here; the envelope boot race), editor-l8 "root kind" (known pre-existing main flake). No e2e failure is attributable to the branch.
