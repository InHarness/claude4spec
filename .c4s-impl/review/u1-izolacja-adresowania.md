# Review u1-izolacja-adresowania — non-blocking findings (round 1)

- **rev-0001** `src/server/services/artifact-registry.ts:144` — `bindingAddress` (and `ThreadArtifactPointers`) is never called from production code, only from tests. No internal rendering uses it yet: patch-tools still resolves the thread's patch from the `patchPath` closed over in `PatchThreadToolsContext`. So the goal's claim that the internal address comes from the binding matrix holds only in tests. Either wire it into the thread-tool construction (patch now, plan in u2) or keep it out until a caller lands, so it is not dead code.

- **rev-0002** `src/server/services/artifact-registry.ts:137` — `THREAD_FIELD_OF_COLUMN` is keyed by `string` instead of `ArtifactThreadColumn` (the `ARTIFACT_THREAD_COLUMNS` whitelist in services/chat.ts). A kind that adds a column without a mapping fails only at runtime (the `throw` in `bindingAddress`), not at compile time. Keying it as `Record<ArtifactThreadColumn, keyof ThreadArtifactPointers>` makes it exhaustive and lets the throw go.

- **rev-0003** `src/server/mcp/patch-tools.ts:39` — The `path` shape is now computed by the rule (`artifactAddressingShape('patch','internal')`), but the param description ('Omit to address the patch of the current thread') and the get_patch tool description ('`path` is optional here') still hard-code the optional shape. If M23 ever declares isolation (absent) the param disappears but the tool text still describes it. That partly defeats the 'rendering cannot disagree with the rule' intent stated in addressing.ts.

