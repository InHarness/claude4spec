export type CliErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'ENTITY_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'INVALID_TYPE'
  | 'INVALID_ARGS'
  | 'AMBIGUOUS_SLUGS'
  | 'SCHEMA_OUT_OF_DATE'
  | 'FILE_NOT_FOUND'
  | 'UNKNOWN_COMMAND';

export class CliError extends Error {
  constructor(public code: CliErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'CliError';
  }
}
