# Review u4-push-non-fast-forward-recovery

- Round 1: **rev-0001 (blocking, fixed in round 2)** — the recover window could be dismissed while Sync was in flight, losing the outcome (no reload, own-op mark stuck). Fixed: not dismissible while syncing + mutation-level outcome handlers.
- Round 2, non-blocking: **rev-0002** `src/client/ui/modals/GitSyncRecover.tsx:79` — a window replaced by ModalHost mid-flight that gets `busy` gives no feedback (setSyncHint on an unmounted component); a toast fallback is optional.
