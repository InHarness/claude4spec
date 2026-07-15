import type { ParsedArgs } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { writeOutput } from '../output.js';
import { AgentError } from '../../../core/agent/run-agent.js';
import { markBriefImplemented } from '../../../core/agent/mark-brief-implemented.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 * `c4s mark-brief-implemented` — the terminal implementer-agent's server-backed
 * way to flip a brief's `implemented` flag (0.1.106). Unlike its
 * filesystem-only siblings (`list-briefs`/`read-brief`/`file-patch`), this one
 * requires a running `npx @inharness-ai/claude4spec` server: it wraps
 * `PATCH /api/briefs/:path/frontmatter`, the only mutable frontmatter key.
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
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'BRIEF_NOT_FOUND', 'IMMUTABLE_FIELD'],
  handler: runMarkBriefImplemented,
};
