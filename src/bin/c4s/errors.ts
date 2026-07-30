export type CliErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'ENTITY_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'INVALID_TYPE'
  | 'INVALID_VIEW'
  | 'INVALID_ARGS'
  | 'AMBIGUOUS_SLUGS'
  | 'SCHEMA_OUT_OF_DATE'
  | 'FILE_NOT_FOUND'
  | 'UNKNOWN_COMMAND'
  // M11 `c4s ask` — server discovery + propagacja statusow endpointu M05.
  | 'SERVER_NOT_RUNNING'
  | 'SERVER_NOT_RECOGNIZED'
  | 'NOT_FOUND'
  | 'STREAM_IN_PROGRESS'
  | 'AGENT_UNAVAILABLE'
  | 'AGENT_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  // M31 workspace model — registry-based resolution + per-project URL prefix.
  | 'AMBIGUOUS_WORKSPACE'
  | 'INDEX_NOT_MATERIALIZED'
  | 'PROJECT_NOT_IN_WORKSPACE'
  // 0.1.103 — --project resolved as a NAME/slug (not a path): distinguishes
  // an injected, externally-copied SKILL.md identity from the path-based
  // PROJECT_NOT_FOUND/AMBIGUOUS_WORKSPACE above.
  | 'PROJECT_SLUG_NOT_FOUND'
  | 'AMBIGUOUS_PROJECT'
  // M33 phase 3 — `c4s plugins doctor` exits with this when a pool package was
  // built against an incompatible MAJOR Host API (the only non-zero plugins exit).
  | 'HOST_API_INCOMPATIBLE'
  // 0.1.103 M11 — filesystem-only brief/patch command family.
  | 'BRIEF_NOT_FOUND'
  | 'PATCH_WRITE_FAILED'
  // 0.1.106 M11 — `c4s mark-brief-implemented` (server-delegating; M36 renamed
  // BRIEF_FRONTMATTER_IMMUTABLE -> IMMUTABLE_FIELD, shared with patch).
  | 'IMMUTABLE_FIELD'
  // 0.1.104 M22 — `c4s install-skills`.
  | 'SKILLS_WRITE_FAILED'
  // 0.1.104 — `c4s agent --ct brief` create-mode error propagation.
  | 'VALIDATION'
  | 'BRIEF_SAME_RELEASE'
  | 'RELEASE_NOT_FOUND'
  // 0.2.1 M38 — `c4s create-plugin` (mode `scaffold`). INVALID_TARGET and
  // TARGET_EXISTS are raised before anything is fetched or written;
  // TEMPLATE_FETCH_FAILED rolls back what this run created; INSTALL_FAILED
  // deliberately does NOT (the files stay, so a retry needs no refetch).
  | 'INVALID_TARGET'
  | 'TARGET_EXISTS'
  | 'TEMPLATE_FETCH_FAILED'
  // Not in the brief, which has no code for a write failure during expansion:
  // without it a read-only target or ENOSPC escapes untyped and the bin reports
  // it as UNKNOWN_COMMAND/exit 1. Rolls back like the two above it.
  | 'SCAFFOLD_WRITE_FAILED'
  | 'INSTALL_FAILED'
  // 0.2.3 M39 — MAPPED FROM THE DISCOVERY CORE, not raised by the CLI itself.
  // The other core codes (ENTITY_NOT_FOUND, SECTION_NOT_FOUND, INVALID_TYPE,
  // INVALID_VIEW, AMBIGUOUS_*, INDEX_NOT_MATERIALIZED) were already in this
  // union under their own names; these two are new here because no CLI command
  // used to be able to address a page or to refuse an argument the way the core
  // does. `INVALID_ARGUMENT` is deliberately NOT folded into the CLI's own
  // `INVALID_ARGS`: one means "you typed the flags wrong", the other carries a
  // correction from the core, and collapsing them would lose the hint.
  | 'PAGE_NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'AMBIGUOUS_ENTITY'
  | 'AMBIGUOUS_PAGE';

export class CliError extends Error {
  constructor(public code: CliErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'CliError';
  }
}
