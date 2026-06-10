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
  | 'PROJECT_NOT_IN_WORKSPACE';

export class CliError extends Error {
  constructor(public code: CliErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'CliError';
  }
}
