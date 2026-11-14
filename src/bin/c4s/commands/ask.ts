import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { AgentError, runAgent } from '../../../core/agent/run-agent.js';
import { parseModelFlag } from '../model-flag.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 * `c4s ask` — read-only peer-consult shorthand (M11 / 0.1.79).
 *
 * Narrowed alias of `c4s agent` with two fixed axes: the turn's value is the
 * PEER's consultation value — the one with `Wejście: konsultacja` in its
 * registry, picked by the peer when `runAgent({ consultation: true })` founds
 * the thread with `entry: "consultation"` (2.1.88, M11 `m11dcore`) — and
 * `output: 'final'` (terse `{ threadId, answer }`). It is the canonical
 * peer-consult shorthand and the CLI twin of the MCP `ask` tool. `--ct` /
 * `--brief` / `--plan` / `--patch` are rejected: the caller names no value.
 *
 *   c4s ask "<msg>"                 # consult the peer for the cwd's project
 *   c4s ask "<msg>" --project <p>   # consult a specific peer, by path or registered name
 *   c4s ask "<msg>" --thread <id>   # continue an existing ask thread
 */
export async function runAsk_cli(args: ParsedArgs): Promise<void> {
  const message = args.positional[0];
  if (!message || !message.trim()) {
    throw new CliError('INVALID_ARGS', 'message is required: c4s ask "<msg>"');
  }

  // The value of the peer's turn is the peer's to decide — these flags belong
  // to `c4s agent`, not the shorthand.
  if (args.flags.has('ct')) {
    throw new CliError(
      'INVALID_ARGS',
      '`c4s ask` takes no --ct: the peer picks the value of a consultation; use `c4s agent --ct <value>` to pick one',
    );
  }
  if (args.flags.has('brief')) {
    throw new CliError('INVALID_ARGS', '`c4s ask` does not take --brief; use `c4s agent --ct brief`');
  }
  if (args.flags.has('plan')) {
    throw new CliError('INVALID_ARGS', '`c4s ask` does not take --plan; use `c4s agent --plan <planPath>`');
  }
  if (args.flags.has('patch')) {
    throw new CliError('INVALID_ARGS', '`c4s ask` does not take --patch; use `c4s agent --ct patch --patch <path>`');
  }

  const threadId = optionalString(args, 'thread');
  const server = optionalString(args, 'server');
  const effort = optionalString(args, 'effort');
  const model = parseModelFlag(args);
  const project = args.project;
  const workspace = args.workspace;

  let result: { threadId: string; answer: string };
  try {
    result = await runAgent({
      message,
      project,
      workspace,
      server,
      consultation: true,
      threadId,
      effort: effort as 'low' | 'medium' | 'high' | undefined,
      model,
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

/**
 * 2.1.26 — the `cli` rendering of the catalog operation `ask` (its record's
 * `cli: direct`), so the contribution names it rather than standing in the
 * NON_CATALOG_DELEGATING exceptions. Its codes are the operation's seventeen
 * (2.1.58: with WORKSPACE_NOT_REGISTERED and WORKSPACE_FILE_INVALID, which come
 * with the shared resolver set): the shared resolver/server set plus
 * `INVALID_ARGS` and `RESUME_CONFIG_LOCKED` — 2.1.88: and the peer's
 * `PROJECT_WITHOUT_CONSULTATION`, eighteen.
 */
export const askCommand: CliCommandContribution = {
  name: 'ask',
  operation: 'ask',
  executionMode: 'server-delegating',
  flags: ['ct', 'brief', 'plan', 'patch', 'thread', 'effort', 'model'],
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'RESUME_CONFIG_LOCKED', 'PROJECT_WITHOUT_CONSULTATION'],
  handler: runAsk_cli,
};
