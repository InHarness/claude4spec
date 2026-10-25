# Review — m36-artifact-detail-projections (non-blocking)

- **rev-0001** `src/server/services/plan.ts:52` — `export interface PlanReadOpts` sits inside the import block (works via ESM hoisting, but no other service does it); move it below the imports. Double blank line after `readForWrite` (~370). `getByThread` (~415) still takes inline `{ range?: ArtifactRange }` while `getByPath`/`getByAddress` take `PlanReadOpts`.
