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
  // 0.1.106 M11 — `c4s mark-brief-implemented` (server-delegating).
  | 'BRIEF_FRONTMATTER_IMMUTABLE'
  // 0.1.104 M22 — `c4s install-skills`.
  | 'SKILLS_WRITE_FAILED'
  // 0.1.104 — `c4s agent --ct brief` create-mode error propagation.
  | 'VALIDATION'
  | 'BRIEF_SAME_RELEASE'
  | 'RELEASE_NOT_FOUND';

export class CliError extends Error {
  constructor(public code: CliErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'CliError';
  }
}
