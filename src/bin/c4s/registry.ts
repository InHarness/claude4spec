import type { ParsedArgs } from './args.js';
import type { CliErrorCode } from './errors.js';

/**
 * L14 — CLI Commands. Each command a module contributes to the `c4s` bin
 * is one of these; `src/bin/c4s.ts` holds no domain logic, only dispatch.
 *
 * `executionMode` is a mandatory declaration — it determines the command's
 * environment requirements and error surface:
 *   - `server-delegating` — renders a catalog operation by calling the owning
 *                           module's SERVER ROUTE under `/api/projects/:id/…`.
 *                           Requires a live server and a health-check. Since
 *                           0.2.13 this is nearly every command.
 *   - `fs-scoped`         — operates on the process CWD, no server, no db-slot.
 *   - `registry-write`    — mutates `~/.claude4spec/workspaces.json` directly (M31
 *                           `trust-plugins`): no project resolution, no db-slot, no
 *                           server; the project record is created on demand rather
 *                           than looked up.
 *   - `scaffold`          — server-free bootstrap of a NEW directory under the CWD
 *                           (M38 `create-plugin`). The only mode that runs outside
 *                           any specification project: no `--project`/`--project-path`
 *                           walk-up to `.claude4spec/`, no db-slot, no health-check,
 *                           and the shared `--project` / `--workspace` / `--server`
 *                           selectors do not apply. From the M11 runtime it inherits
 *                           only the error envelope, `codeToExit` and the output
 *                           formats.
 *
 * ## `readonly-reader` is gone (0.2.13, item 23)
 *
 * It named the mode where a command opened `db.sqlite` `readonly: true` and
 * answered from its own discovery core. That made the `c4s` process a second
 * execution locus for operations the server also implemented — the drift this
 * release removes. There is no mode for reading the specification without a
 * server any more, because there is no way to do it.
 *
 * `errorCodes` lists only the codes THIS command contributes to the
 * `CliErrorCode` union beyond the shared codes below.
 */

/**
 * Codes any command may raise before it addresses a server — project selection
 * from the registry. Declared once here rather than repeated per contribution.
 *
 * 0.2.13 dropped `INDEX_NOT_MATERIALIZED` and `SCHEMA_OUT_OF_DATE` from this
 * list: both described the state of a db slot THIS PROCESS had opened, and it
 * no longer opens one. A stale or unmaterialized index is now the server's
 * business, and what the caller sees is whatever the operation answered.
 */
export const SHARED_RESOLVER_CODES: readonly CliErrorCode[] = [
  'PROJECT_NOT_FOUND',
  'PROJECT_SLUG_NOT_FOUND',
  'AMBIGUOUS_WORKSPACE',
  'AMBIGUOUS_PROJECT',
];

/**
 * Shared error group for `server-delegating` commands: address resolution plus
 * the health-check's five disjoint outcomes (M05/M31), on top of
 * `SHARED_RESOLVER_CODES`.
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
  executionMode: 'server-delegating' | 'fs-scoped' | 'registry-write' | 'scaffold';
  /**
   * The catalog operation this command RENDERS, when it renders one.
   *
   * 0.2.13 item 26 makes a contribution invalid if it renders a catalog
   * operation in any mode other than `server-delegating`, or declares
   * `server-delegating` while rendering none. Neither half of that can be
   * checked without naming the operation: the catalog's `cli` channel cell says
   * only `direct`/`via`/`na`, not which command carries it, and a command's own
   * name is not the operation's (`inline_mention` renders `get_entities`; five
   * XML-tag commands front the same one). See
   * `validateCommandContributions` below.
   *
   * Absent means "renders no catalog operation" — the agent flow, and the three
   * server-free modes.
   */
  operation?: string;
  /** Error codes contributed to the `CliErrorCode` union by this command specifically. */
  errorCodes: readonly CliErrorCode[];
  /** Delegates to the owning module's server route; the bin itself carries no domain logic. */
  handler: (args: ParsedArgs) => Promise<void>;
}

/**
 * Commands that are `server-delegating` and legitimately render NO catalog
 * operation.
 *
 * An agent turn is not a catalog operation — the catalog's subject is
 * specification CONTENT (or a turn OVER that content addressed as one), and
 * these two address the agent runtime itself: they create a thread and run a
 * turn on it. `resolve` is the other kind of exception: it is a composition over
 * `get_entities`/`list_entities` and deliberately has no operation of its own,
 * because an expanded embed hands the consumer a payload where it had an edge.
 *
 * The list is short and has to stay that way. Its purpose is to make each
 * exception a decision someone wrote down, rather than the check quietly
 * admitting anything it does not recognise.
 */
const NON_CATALOG_DELEGATING = new Set(['agent', 'ask', 'resolve']);

/**
 * Item 26 — the contribution invariant, in both directions.
 *
 * Returns the problems rather than throwing, so a test can report all of them at
 * once instead of one per run.
 */
export function validateCommandContributions(
  commands: readonly CliCommandContribution[],
  isCatalogOperation: (name: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const c of commands) {
    if (c.operation !== undefined) {
      if (!isCatalogOperation(c.operation)) {
        problems.push(`${c.name}: declares operation '${c.operation}', which is not in the catalog`);
      }
      if (c.executionMode !== 'server-delegating') {
        // Executing a catalog operation belongs to the server process. A command
        // that renders one in any other mode is a second locus by definition.
        problems.push(
          `${c.name}: renders the catalog operation '${c.operation}' in mode '${c.executionMode}' — a catalog operation is executed by the server, so the mode must be 'server-delegating'`,
        );
      }
    } else if (c.executionMode === 'server-delegating' && !NON_CATALOG_DELEGATING.has(c.name)) {
      problems.push(
        `${c.name}: declares 'server-delegating' but names no catalog operation — either set \`operation\`, or add it to NON_CATALOG_DELEGATING with a reason`,
      );
    }
  }
  return problems;
}
