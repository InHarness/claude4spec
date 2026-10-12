# m21-brief-tools — non-blocking review findings

- **rev-0001** `src/server/operations/addressing.ts:64` — The new OWNER_THREAD_ISOLATION.brief docblock says the declaration covers `mark_brief_implemented`, but that operation has no internal rendering at all (brief-tools does not mount it; brief-tools.test.ts lists it in DECLARED_NOT_RENDERED_INTERNALLY). The comment overstates what the switch affects; name only the four rendered operations (get_brief, update_brief, list_brief_versions, get_brief_version).
