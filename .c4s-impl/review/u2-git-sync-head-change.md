# Review u2-git-sync-head-change — non-blocking findings (round 1)

- **rev-0001** `src/shared/types.ts:194` — WsEvent comment says the ProjectContext is already invalidated when `git:status-changed {headChanged:true}` fires; the real order is event → reload (route calls onHeadChanged after the service returns). A client (u3) must not assume a refetch on the event sees the rebuilt context.
- **rev-0002** `src/server/fs/head-change-origin.ts:66` — realpathOfNearestAncestor() duplicates the private helper in services/git.ts:1852.
- **rev-0003** `src/server/fs/head-change-origin.ts:43` — comment claims `mounts` is re-read per call; the caller passes a frozen array.
