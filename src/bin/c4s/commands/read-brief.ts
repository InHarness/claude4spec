import type { ParsedArgs } from '../args.js';
import { delegateGet } from '../delegate.js';
import { AgentError } from '../../../core/agent/http.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s read-brief <brief-path> [--format json|text]
 *
 * `<brief-path>` is relative to `briefsDir` — parity with the `--brief` argument
 * elsewhere.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/artifacts/brief/<path>`. Path
 * traversal is refused by the server rather than by a local guard, which is the
 * only place it can be refused now: this process cannot see `briefsDir`.
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
  const encoded = briefPath.split('/').map(encodeURIComponent).join('/');

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
