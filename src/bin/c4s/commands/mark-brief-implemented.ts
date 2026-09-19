import type { ParsedArgs } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { writeOutput } from '../output.js';
import { AgentError } from '../../../core/agent/run-agent.js';
import { markBriefImplemented } from '../../../core/agent/mark-brief-implemented.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 * `c4s mark-brief-implemented` — the terminal implementer-agent's server-backed
 * way to flip a brief's `implemented` flag (0.1.106). Like every command of the
 * brief/patch family (`list-briefs`/`get-brief`/`create-patch`), it requires a
 * running `npx @inharness-ai/claude4spec` server: it wraps the generic
 * `PATCH /api/artifacts/brief/:path/frontmatter`, and the field restriction
 * (`implemented` is the only mutable key) is the route's
 * `frontmatterContract.mutable` guard, not this bin's.
 *
 *   c4s mark-brief-implemented <brief-path> --project <slug> --workspace <name>
 */
export async function runMarkBriefImplemented(args: ParsedArgs): Promise<void> {
  const briefPath = args.positional[0];
  if (!briefPath) {
    throw new CliError(
      'INVALID_ARGS',
      'mark-brief-implemented requires a brief path',
      'usage: c4s mark-brief-implemented <brief-path> --project <slug> --workspace <name>',
    );
  }

  try {
    const result = await markBriefImplemented({
      briefPath,
      project: args.project,
      workspace: args.workspace,
    });
    writeOutput(result, args);
  } catch (err) {
    if (err instanceof AgentError) {
      throw new CliError(err.code as CliErrorCode, err.message, err.hint);
    }
    throw err;
  }
}

export const markBriefImplementedCommand: CliCommandContribution = {
  name: 'mark-brief-implemented',
  operation: 'update_brief',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'BRIEF_NOT_FOUND', 'IMMUTABLE_FIELD'],
  handler: runMarkBriefImplemented,
};
