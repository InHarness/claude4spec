# workspace-home-model — non-blocking review findings

- **rev-0005** `src/core/workspace/resolve.ts:144` — inside a project of a broken home, a bare `c4s` returns PROJECT_NOT_FOUND with a misleading hint; the cwd-miss branch does not append the `unreadable: …` refusal the id-miss branches carry (dev-0103).
- **rev-0006** `src/server/workspace/registry.ts:381` — the home branch of registerProject no longer checks inside the registry lock that the entry still exists (the registry branch does); a stale view could write into the committed workspace.json of a workspace this machine detached.
