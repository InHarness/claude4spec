# System verification — env-runner run 1 (impl-2-1-14 @ b5ef8d5d, thread uy68_z0SfYmt)

- clone (uid 1000) / npm ci (lockfile) / build:envelopes / build:server / playwright: all exit 0. HEAD in container = b5ef8d5d.
- npm test: 5419 tests, 5416 passed, 3 failed — all three in tests added by this branch:
  - src/server/external-skills/external-skills-service.test.ts `[section:foj9tbk4]` — expected rendered section to contain "It is not how you read the specification…" (m22-skille).
  - src/server/routes/release-pushes.test.ts `[ac:ac-push-bez-upstream-przy-bledzie-sie]` — audit-log response is `{ items: [...] }`, test reads `.length` on it (m28-bramki-git).
  - src/server/services/release-file-roots.test.ts `[section:m17reldisk]` bundle manifest test — TypeError in sanitizeConfigForBundle (`claudeUsePreset` of undefined): test fixture config lacks the agent block (m17-plik-release-roots).
- test:e2e: running.
→ reopen m28-bramki-git, m22-skille, m17-plik-release-roots (only the failing slug each).
