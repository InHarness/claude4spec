# Decisions

- setup (2026-11-14): entityParts `moduly-feature` (spreadsheet) → one `context` part, all rows, key column `#`. Why: it is an index of the specification's modules (nr, name, complexity, layers, scope, file). The window only adds the L15/L16/L19 layers and the M44 scope, so there is nothing in code and no observable expectation.
- setup: jobs — none assigned. The user-jobs address (`pages/SKILL.md` §13) only embeds `moduly-feature`. It has no job rows, so the system verifier alone checks that convention.
- setup: `build.gates = []`. The user's standing preference is to fix non-blocking findings and run to the end without stopping; the always-on stops still apply.
- setup: tests run locally, chosen by the user: `npm test`, filtered `npx vitest run -t "<pattern>"`. `npm ci && npm run build` ran once in the fresh worktree, because the mcp-bridge tests need `dist/`.
