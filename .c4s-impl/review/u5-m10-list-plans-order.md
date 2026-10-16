# Review — u5-m10-list-plans-order (non-blocking)

- rev-0001 `src/server/routes/artifacts.ts:243` — plan adapter duplicates the brief adapter's opt-in limit/offset window (lines 110-115); extract a shared helper next to `parsePaging`.
