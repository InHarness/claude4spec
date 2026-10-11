# Review u2-izolacja-planu — non-blocking findings (round 1)

- **rev-0002** `src/server/services/plan.ts:618` — The thread's plan address now comes from two different places. getByThread and setAppliedByThread read it through the new pinnedPlanPath (bindingAddress over getThreadMeta). update() and its lock keying still read chatService.getThreadPlanPath. Both read the same column today, but the internal read and the internal write of the plan, which is exactly the isolation boundary this unit introduces, could drift if the M36 binding column changes. Consider routing update() through pinnedPlanPath too, or noting why it stays.


# Review u2-izolacja-planu — non-blocking findings (round 2)

- **rev-0002** `src/server/services/plan.ts:618` — Carried over from round 1. It was not addressed and decisions.md gives no reason for keeping it. update() and its lock keying still read the thread's plan address through chatService.getThreadPlanPath. getByThread and setAppliedByThread read it through pinnedPlanPath (bindingAddress over getThreadMeta). Both read the same column today, but the internal read and the internal write could drift if the M36 binding column changes.

- **rev-0003** `src/server/routes/artifacts.ts:262` — In the plan adapter, input validation runs before the address check. getVersion checks rawVersion first, and updateFrontmatter checks the `applied` type first. So a request with an unknown path and a bad argument (e.g. GET /api/artifacts/plan/no-such.md/versions/abc) answers INVALID_ARGUMENT, not PLAN_NOT_FOUND. Both codes are on the rows, so this is a defensible order. It is noted only so the precedence is a deliberate choice.

