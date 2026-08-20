import type { ParsedArgs } from '../args.js';
import { delegateGet } from '../delegate.js';
import { AgentError, encodeArtifactPath } from '../../../core/agent/http.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { writeOutput } from '../output.js';
import { optionalString } from '../args.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s read-brief <brief-path> [--range <from>:<to>] [--format json|text]
 *
 * `<brief-path>` is relative to `briefsDir` — parity with the `--brief` argument
 * elsewhere.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/artifacts/brief/<path>`.
 *
 * 0.2.40 — `--range` is the artifact read family's window, spelled exactly as
 * `c4s get-page --range`. It is unconditionally available: a brief never enters
 * `section_index`, so a line window is the only way to read a large one through,
 * and there is no root kind for it to be gated on.
 */
export async function runReadBrief(args: ParsedArgs): Promise<void> {
  const briefPath = args.positional[0];
  if (!briefPath) {
    throw new CliError(
      'INVALID_ARGS',
      'read-brief requires a brief path',
      'usage: c4s read-brief <brief-path>',
    );
  }
  /**
   * The traversal guard stays HERE, and cannot be delegated.
   *
   * `readBriefFs` used to refuse `../..` via `assertSafeRelPath` before reading
   * anything. Moving the read to the server does not move that check with it,
   * because the traversal never arrives at the server as a path:
   * `encodeURIComponent` leaves `..` untouched (it is not a reserved character),
   * and WHATWG URL resolution inside `fetch` collapses the dot segments before
   * the request goes out. So `c4s read-brief ../../config` was rewritten into
   * `GET /api/projects/<id>/config` — a different, existing endpoint, which
   * answers 200 with the project config. The command then printed `{}` (none of
   * `frontmatter`/`body`/`content` are on that payload) and exited 0.
   *
   * A confidently empty answer where the old code refused outright.
   * `encodeArtifactPath` refuses it again, before the URL is built.
   */
  try {
    const encoded = encodeArtifactPath(briefPath);
    const range = parseRange(optionalString(args, 'range'));
    const brief = (await delegateGet(args, `/artifacts/brief/${encoded}`, {
      ...(range ? { range: `${range.start}:${range.end}` } : {}),
    })) as {
      frontmatter: unknown;
      body: string;
      content: string;
      truncated?: true;
      truncationHint?: string;
    };
    // The same three fields the filesystem reader answered with, in the same
    // order: a caller piping this into `jq '.body'` must not have to change.
    // `truncated`/`truncationHint` join them only when something was cut — a
    // reader that never hits the budget sees the payload it always saw.
    writeOutput(
      {
        frontmatter: brief.frontmatter,
        body: brief.body,
        content: brief.content,
        ...(brief.truncated
          ? { truncated: brief.truncated, truncationHint: brief.truncationHint }
          : {}),
      },
      args,
    );
  } catch (err) {
    // The artifact route 404s as the generic NOT_FOUND. This command's entire
    // domain is one brief path, so it answers with the brief-specific code —
    // the same re-framing `mark-brief-implemented` has always done.
    if ((err instanceof CliError || err instanceof AgentError) && err.code === 'NOT_FOUND') {
      throw new CliError('BRIEF_NOT_FOUND', err.message, err.hint);
    }
    /**
     * Any other `AgentError` becomes a `CliError` carrying the SAME code.
     *
     * `encodeArtifactPath` throws one, and it used to be thrown outside this
     * block — so the traversal refusal reached the bin's generic fallback and
     * was reported as `UNKNOWN_COMMAND`, exit 1. The refusal was correct and its
     * exit status was not, which for a wrapper script is the same bug in a
     * different place: `INVALID_ARGS` is exit 4, and only the mapping says so.
     */
    if (err instanceof AgentError) {
      throw new CliError(err.code as CliErrorCode, err.message, err.hint);
    }
    throw err;
  }
}

/** `--range 1:200` → `{ start: 1, end: 200 }`. 1-based and inclusive, like the core's. */
function parseRange(raw: string | undefined): { start: number; end: number } | undefined {
  if (raw === undefined) return undefined;
  const m = /^(\d+):(\d+)$/.exec(raw);
  if (!m) {
    throw new CliError(
      'INVALID_ARGS',
      `--range must be '<from>:<to>', got '${raw}'`,
      '--range 1:400 — 1-based and inclusive',
    );
  }
  return { start: Number(m[1]), end: Number(m[2]) };
}

export const readBriefCommand: CliCommandContribution = {
  name: 'read-brief',
  operation: 'get_brief',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'BRIEF_NOT_FOUND'],
  handler: runReadBrief,
};
