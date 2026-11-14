# Review — consultation-entry (non-blocking)

- **rev-0001** `src/server/routes/threads.ts:96`: The `opens` list in the refusal message repeats the predicate of `newThreadRowOf` inline (`r.entry.includes('new-thread') || r.entry.includes('default')`). The diff adds that predicate to `context-types/registry.ts` for exactly this decision. If the 'opens a new thread' rule changes in one place, the route's message and its acceptance can drift apart. Export a row predicate (e.g. `opensNewThread(row)`) from registry.ts and use it in both places.
