# System verification — env-runner evidence (2-1-47-to-2-1-48)

- sha under test: 250ed7dc (code identical to ec889d57 apart from src/server/routes/artifacts.test.ts); app image built at create from ec889d57.
- npm run typecheck: exit 0 (r1, r2).
- npm test: r1 (ec889d57) 2 failed (artifacts.test.ts plan route tests, 400 from body limit) → fixed in 250ed7dc; r2 3/3 isolated artifacts.test.ts green; full suite sequential & unloaded 6838/6838 twice. A load-induced timeout of chat.live-join.test.ts (untouched by the branch) appeared in two full runs under parallel Docker load; 3/3 isolated green; main 6803/6803 twice.
- npm run test:e2e (full, r2): 210 passed, 12 skipped, failures only in the 3 seed-only files that also fail on 2.1.47/main (artifact-threads-panel, entity-version-history, plan-footer — "seed one first"). editor-l8 'root kind' is a main flake (2/3 red on a main env).
- Logs: /Users/michael/Code/ctowiec/claude4spec-private/env-runner/envs/2-1-47-to-2-1-48.*, 2-1-47-cmp.*, 2-1-47-main-l8.*
