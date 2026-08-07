import type { ParsedArgs } from '../args.js';
import { delegateGet } from '../delegate.js';
import { AgentError, encodeArtifactPath } from '../../../core/agent/http.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s read-brief <brief-path> [--format json|text]
 *
 * `<brief-path>` is relative to `briefsDir` — parity with the `--brief` argument
 * elsewhere.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/artifacts/brief/<path>`.
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
  const encoded = encodeArtifactPath(briefPath);

  try {
    const brief = (await delegateGet(args, `/artifacts/brief/${encoded}`)) as {
      frontmatter: unknown;
      body: string;
      content: string;
    };
    // The same three fields the filesystem reader answered with, in the same
    // order: a caller piping this into `jq '.body'` must not have to change.
    writeOutput({ frontmatter: brief.frontmatter, body: brief.body, content: brief.content }, args);
  } catch (err) {
    // The artifact route 404s as the generic NOT_FOUND. This command's entire
    // domain is one brief path, so it answers with the brief-specific code —
    // the same re-framing `mark-brief-implemented` has always done.
    if ((err instanceof CliError || err instanceof AgentError) && err.code === 'NOT_FOUND') {
      throw new CliError('BRIEF_NOT_FOUND', err.message, err.hint);
    }
    throw err;
  }
}

export const readBriefCommand: CliCommandContribution = {
  name: 'read-brief',
  operation: 'get_brief',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'BRIEF_NOT_FOUND'],
  handler: runReadBrief,
};
