# Review u3-header-fetch-sync-ui — non-blocking findings (round 1)

- **rev-0001** `src/client/components/GitStatusBadge.tsx:83` — busy/dirty hints never auto-clear (only on the next op); stale busy hint, list hint reappears on reopen.
- **rev-0002** `src/client/lib/git-ws.ts:29` — any `headChanged:true` arriving while this client's sync is in flight is taken as its own: if another client moved HEAD and this sync answers `busy`/`up-to-date`, a false "Updated from the remote" toast is parked and shown after the later reload. Fix: drop the parked flash in useGitSync onSettled unless fast-forwarded/merged.
- **rev-0003** `src/client/components/GitStatusBadge.tsx:62` — event-before-reload order is handled; residual race: a reloaded tab may rejoin the room before `project:disposed` is sent → second reload, flash toast already consumed and lost.
