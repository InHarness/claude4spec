# m52-skill-use-confirmations — non-blocking review findings

- **rev-0001** `src/client/components/spec-skills/specSkillsSettings.tsx:54` — `confirmationAfter` rebuilds the confirmed list from the rows only; the project's own exposed name is never a row (`listExposedProjectRows` skips `own`, `exposed-projects.ts` ~182), so a confirmed own name (route test `shop-skill`) is dropped by the next save from the #skills card (PUT replaces the list). Options: show it, merge server-side, or document the exclusion.
