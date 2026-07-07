import type { ParsedArgs } from './args.js';
import type { CliErrorCode } from './errors.js';

/**
 * L14 — CLI Commands. Each command a module contributes to the `c4s` bin
 * is one of these; `src/bin/c4s.ts` holds no domain logic, only dispatch.
 *
 * `executionMode` is a mandatory declaration — it determines the command's
 * environment requirements and error surface:
 *   - `readonly-reader`   — opens SQLite read-only (via `createContext`), no server.
 *   - `fs-scoped`         — operates on the resolved project's files/cwd, no server, no db-slot.
 *   - `server-delegating` — wraps a REST call under `/api/projects/:id/…`, requires a live server + health-check.
 *
 * `errorCodes` lists only the codes THIS command contributes to the
 * `CliErrorCode` union beyond the shared resolver codes every command may
 * throw before any network/db access (`PROJECT_NOT_FOUND`,
 * `PROJECT_SLUG_NOT_FOUND`, `AMBIGUOUS_WORKSPACE`, `AMBIGUOUS_PROJECT`,
 * `INDEX_NOT_MATERIALIZED`, `SCHEMA_OUT_OF_DATE`) — those are declared once,
 * here, rather than repeated on every contribution.
 */
export const SHARED_RESOLVER_CODES: readonly CliErrorCode[] = [
  'PROJECT_NOT_FOUND',
  'PROJECT_SLUG_NOT_FOUND',
  'AMBIGUOUS_WORKSPACE',
  'AMBIGUOUS_PROJECT',
  'INDEX_NOT_MATERIALIZED',
  'SCHEMA_OUT_OF_DATE',
];

/**
 * Shared error group for `server-delegating` commands (`agent`/`ask`/
 * `mark-brief-implemented`): health-check + run-turn propagation from the
 * peer server (M05), on top of `SHARED_RESOLVER_CODES`.
 */
export const SERVER_DELEGATING_CODES: readonly CliErrorCode[] = [
  'SERVER_NOT_RUNNING',
  'SERVER_NOT_RECOGNIZED',
  'PROJECT_NOT_IN_WORKSPACE',
  'NOT_FOUND',
  'STREAM_IN_PROGRESS',
  'AGENT_UNAVAILABLE',
  'AGENT_ERROR',
  'TIMEOUT',
  'ABORTED',
];

export interface CliCommandContribution {
  /** Command name as typed on the CLI, e.g. `find-references`. */
  name: string;
  executionMode: 'readonly-reader' | 'fs-scoped' | 'server-delegating';
  /** Error codes contributed to the `CliErrorCode` union by this command specifically. */
  errorCodes: readonly CliErrorCode[];
  /** Delegates to the owning module's core; the bin itself carries no domain logic. */
  handler: (args: ParsedArgs) => Promise<void>;
}
