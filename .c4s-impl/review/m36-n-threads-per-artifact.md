# Review — m36-n-threads-per-artifact (non-blocking)

- rev-0001 `src/server/routes/artifacts.ts:310` — plan adapter ignores `name` from ArtifactThreadCreateRequest (accepted, validated, then dropped; thread titled from plan frontmatter). Fix: pass `name ?? title`, or document that plan ignores it; tests check `name` only for brief/patch.
