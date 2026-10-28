# U3-aktywacja-bez-zapisow — non-blocking review findings

- round 1, rev-0001 (`src/server/workspace/project-context.ts:685`): background «text-migration» checks are wider than what the write path repairs (release backfill per-row failures, timestamp backfill swallowed by try/catch, undroppable legacy plan table) → a project can stay «needs activation» forever, every background build/rebuild. Reviewer: fix before U4a wires the production caller (failed pending migration = build error, or narrow the check). Orchestrator note: carry into U4a.
