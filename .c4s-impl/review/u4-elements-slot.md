# u4-elements-slot — non-blocking findings

- rev-0001 `src/client/components/Sidebar.tsx:353` — group counter shows "…" until every member key is in entityCounts; a failed /api/entities/counts read (App passes `?? {}`) leaves "…" forever while type entries fall back to 0. Tie the placeholder to the counts query loading state.
