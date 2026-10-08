# System suite (env-runner pr258-system)

## Run 1 — 9a1fa46, deps installed without lockfile, as root
- e2e: 39 files, 34 pass, 5 fail — all seed preconditions on an empty env (plan-footer, artifact-threads-panel: "no plan … seed one first"; entity-version-history: no unversioned entity; envelope-entity-pages passes 7/7 alone — order dependent).
- vitest: 389/399 files, 4781 passed / 71 failed.
## Run 2 — 9a1fa46, npm ci from lockfile, uid 1000, the 10 failing files
- 6 files green (golden 47/47, create-patch, page-tools, reference-tools, diagram mcp-server, plugin-runtime-resolver) → their failures were environment (agent-adapters main, MCP SDK 1.32.1/zod 4.6.5, root, tsx).
- 4 files red, all tests added by this branch, all test bugs (no production change):
  - static.route.test.ts — rig never called registerCoreReactions();
  - briefs-patches-roots.test.ts — expected BRIEF_HEADER.immutable order wrong (roots is last);
  - release-diff-git.test.ts — fixture inserts empty description (CHECK constraint);
  - buildMarkdownIt.context.test.ts — `@path.md` stops before the `.` by design; fixture now `@modules/m01-auth`.
## Run 3 — d1e37e1, npm ci from lockfile, uid 1000, FULL vitest suite
- **399/399 files, 4853/4853 tests passed, 0 failed** (exit 0). Logs: env-runner/logs/pr258-run4-d1e37e1/.
- e2e not rerun (no e2e or app code changed since run 1; the 4 test fixes touch unit tests only). Run 1 e2e: 34/39 green; the 5 red files fail on seed preconditions of an empty env (explicit "seed one first" / "no unversioned entity" in beforeAll; envelope-entity-pages green 7/7 alone).
