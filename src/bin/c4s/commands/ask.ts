import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { AgentError, runAgent } from '../../../core/agent/run-agent.js';

/**
 * `c4s ask` — read-only peer-consult shorthand (M11 / 0.1.79).
 *
 * Narrowed alias of `c4s agent`: hardcodes `contextType='ask'` and
 * `output: 'final'` (terse `{ threadId, answer }`). It is the canonical
 * peer-consult shorthand and the CLI twin of the MCP `ask` tool — the peer
 * answers read-only, never mutating its own spec. `--ct` / `--brief` are
 * rejected (use `c4s agent` for other contexts).
 *
 *   c4s ask "<msg>"                 # consult the peer for the cwd's project
 *   c4s ask "<msg>" --project <p>   # consult a specific peer
 *   c4s ask "<msg>" --thread <id>   # continue an existing ask thread
 */
export async function runAsk_cli(args: ParsedArgs): Promise<void> {
  const message = args.positional[0];
  if (!message || !message.trim()) {
    throw new CliError('INVALID_ARGS', 'message is required: c4s ask "<msg>"');
  }

  // `ask` is locked to the read-only ask context — these flags belong to
  // `c4s agent`, not the shorthand.
  if (optionalString(args, 'ct') !== undefined) {
    throw new CliError('INVALID_ARGS', '`c4s ask` is always --ct=ask; use `c4s agent` to pick a context');
  }
  if (optionalString(args, 'brief') !== undefined) {
    throw new CliError('INVALID_ARGS', '`c4s ask` does not take --brief; use `c4s agent --ct brief`');
  }

  const threadId = optionalString(args, 'thread');
  const server = optionalString(args, 'server');
  const effort = optionalString(args, 'effort');
  const project = args.project;
  const workspace = args.workspace;

  if (project && server) {
    process.stderr.write('warning: both --project and --server given; --server wins, --project ignored\n');
  }

  let result: { threadId: string; answer: string };
  try {
    result = await runAgent({
      message,
      project,
      workspace,
      server,
      contextType: 'ask',
      threadId,
      effort: effort as 'low' | 'medium' | 'high' | undefined,
      output: 'final',
    });
  } catch (err) {
    if (err instanceof AgentError) {
      throw new CliError(err.code as CliErrorCode, err.message, err.hint);
    }
    throw err;
  }

  // --- output --------------------------------------------------------------
  if (args.format === 'text') {
    process.stdout.write(result.answer + '\n');
    // threadId na stderr — hint do kontynuacji wątku.
    process.stderr.write(`thread: ${result.threadId} (continue: c4s ask "..." --thread ${result.threadId})\n`);
  } else {
    process.stdout.write(JSON.stringify({ threadId: result.threadId, answer: result.answer }, null, 2) + '\n');
  }
}

// Eksport pod historyczna nazwa — `src/bin/c4s.ts` importuje `runAsk`.
export { runAsk_cli as runAsk };
