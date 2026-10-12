# u2 — non-blocking
- rev-0001 `src/client/hooks/useDiagrams.ts:88` — `useDeleteDiagram` has no callers after `entities/diagram/detail-panel.tsx` was removed (dead code).
- verifier note — `chipprops` says the slot smoke test checks `renderCard` only with a passed entity; `src/client/runtime/validate-slots.ts` renders only `renderChip(null)` and never `renderCard`. Outside the goal sentence; not reopened.
