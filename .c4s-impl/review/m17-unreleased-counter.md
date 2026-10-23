# Review m17-unreleased-counter — non-blocking findings

- **rev-0001** `src/server/routes/releases.ts:51` — `GET /api/releases/unreleased-count` (per-version `ReleaseService.countUnreleased` / `FileVersionService.countUnreleased`) stays with no client/CLI/MCP caller and returns a contradictory count (3 edits of one entity → 3 there, 1 in the real counter). Remove the route and both methods (release-root-rename.test.ts:174 uses the file-version one), or record a decision to keep it. Human decision.
- **rev-0002** `src/client/lib/release-diff-invalidation.ts:34` — every content event invalidates the whole `['release-diff']` prefix, refetching frozen release→release diffs too. Narrow content events to `queryKey[2] === 'current'`. Efficiency only.
