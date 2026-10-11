# Review u4-okno-odczytu-briefu — non-blocking findings (round 1)

- **rev-0001** `src/server/mcp/brief-tools.ts:154` — A blank `path` on the threadless mount now answers BRIEF_NOT_FOUND, but the message still says 'path is required: this connection has no thread…', so the code and the message disagree. Also, the documented contract in src/server/operations/profiles.ts:85-87 (`requiresExplicitBriefTarget`: a missing brief-addressing parameter 'must fail VALIDATION naming the missing field') was left as it was and now contradicts the code. Either update that doc comment, or reword the error so it reads as 'names no brief'.

- **rev-0002** `src/server/services/brief.ts:571` — getVersionAddressed: the REST adapter maps a non-numeric `:version` to NaN, so the user-visible message reads 'version NaN is not in the history of brief …'. Echo the raw value, or say that it must be a positive integer. Also, line 566 calls listVersions (the full metadata list) on every call, the success path included, only to build the hint. Compute it only when the refusal is thrown.

- **rev-0003** `src/server/operations/core-operations.ts:1557` — The mark_brief_implemented comment says 'the `brief` context profile does not expose it' (narrowing at the profile level). No profile mechanism does this: the row has opClass 'brief', so profileAdmits('brief', op), and through it toolAdmittedByProfile, returns true. Only the missing brief-tools tool keeps it out of a brief turn, so a tool with this name added later would pass the gate unnoticed. Fix the comment, or make the exclusion real in profiles.ts.

