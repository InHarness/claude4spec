# Review — m11-agent-patch-thread (non-blocking)

- rev-0003 `src/core/agent/run-agent.ts:386` — `patchAttachRoute` duplicates the plan branch's inline strip/check/encode (line 234) and the NOT_FOUND remap; fold into one `attachRoute(kind, path)`; drop the needless export.
