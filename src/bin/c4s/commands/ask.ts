import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { AskError, runAsk, type AskContextType } from '../../../core/ask/run-ask.js';

/**
 * `c4s ask` — synchroniczny kanal Q&A z agentem specyfikacji (M11).
 *
 * Cienki wrapper nad `runAsk(...)` z `core/ask/run-ask.ts`. Wspolne ciezary
 * (resolve project, health-check, create-thread, run-turn) zyja w core'rze;
 * tutaj zostala tylko warstwa CLI: parsowanie flag, mapowanie kodow bledow
 * na `CliError`, formatowanie outputu (stdout/stderr split, --format json|text).
 *
 *   c4s ask "<msg>" --ct chat
 *   c4s ask "<msg>" --ct brief --brief <path>
 *   c4s ask "<msg>" --thread <id>
 */
export async function runAsk_cli(args: ParsedArgs): Promise<void> {
  const message = args.positional[0];
  if (!message || !message.trim()) {
    throw new CliError('INVALID_ARGS', 'message is required: c4s ask "<msg>" --ct chat');
  }

  const threadId = optionalString(args, 'thread');
  const ct = optionalString(args, 'ct');
  const briefPath = optionalString(args, 'brief');
  const server = optionalString(args, 'server');
  const project = args.project;

  if (project && server) {
    // Mutex `project` vs `server` — gdy oba podane, `server` wygrywa; CLI
    // dopisuje warning na stderr (dla MCP analogicznie, ale przez tool_result).
    process.stderr.write('warning: both --project and --server given; --server wins, --project ignored\n');
  }

  if (!threadId) {
    // Wczesna walidacja flag CLI (drobne komunikaty user-facing); runAsk
    // robi to samo na poziomie biblioteki, ale tutaj dajemy zywsze hinty.
    if (ct !== 'chat' && ct !== 'brief' && ct !== 'patch') {
      throw new CliError(
        'INVALID_ARGS',
        '--ct must be chat|brief|patch (or pass --thread <id> to continue a thread)',
      );
    }
    if (ct === 'patch') {
      throw new CliError(
        'INVALID_ARGS',
        'c4s ask cannot create a patch thread; pass --thread <id> to continue one',
      );
    }
    if (ct === 'brief' && !briefPath) {
      throw new CliError('INVALID_ARGS', '--ct brief requires --brief <path>');
    }
  }

  let result: { threadId: string; answer: string };
  try {
    result = await runAsk({
      message,
      project,
      server,
      contextType: ct as AskContextType | undefined,
      threadId,
      briefPath,
    });
  } catch (err) {
    if (err instanceof AskError) {
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
