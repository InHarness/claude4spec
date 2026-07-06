import type { ParsedArgs } from '../args.js';
import { optionalString, optionalStringList } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import {
  AgentError,
  runAgent,
  type AgentContextType,
  type AgentMessage,
  type AgentParams,
} from '../../../core/agent/run-agent.js';

/**
 * `c4s agent` — generic synchronous agent turn over any thread context (M11).
 *
 * The verbose, developer-facing surface: defaults to `output: 'full'`, so it
 * prints every message of the turn (assistant text + reasoning + tool rows)
 * before the final answer. Cienki wrapper nad `runAgent(...)`; warstwa CLI to
 * parsowanie flag, mapowanie kodow bledow na `CliError`, formatowanie outputu.
 *
 *   c4s agent "<msg>" --ct chat
 *   c4s agent "<msg>" --ct ask                 # read-only peer consult
 *   c4s agent "<msg>" --ct brief --brief <path>                     # attach-mode
 *   c4s agent "<msg>" --ct brief --source release-diff --from <r> --to <r>  # create-mode
 *   c4s agent "<msg>" --ct brief --source initial --to <r>          # create-mode
 *   c4s agent "<msg>" --ct brief --source analysis [--from <r>]     # create-mode
 *   c4s agent "<msg>" --thread <id>            # continue (—ct not needed)
 *
 * The terse peer-consult shorthand lives in `ask.ts` (hardcodes --ct=ask,
 * output: 'final').
 */
export async function runAgentCmd(args: ParsedArgs): Promise<void> {
  const message = args.positional[0];
  if (!message || !message.trim()) {
    throw new CliError('INVALID_ARGS', 'message is required: c4s agent "<msg>" --ct chat');
  }

  const threadId = optionalString(args, 'thread');
  const ct = optionalString(args, 'ct');
  const briefPath = optionalString(args, 'brief');
  const server = optionalString(args, 'server');
  const effort = optionalString(args, 'effort');
  const project = args.project;
  const workspace = args.workspace;

  // 0.1.104 create-mode flags (only meaningful for --ct brief).
  const sourceFlag = optionalString(args, 'source');
  const fromFlag = optionalString(args, 'from');
  const toFlag = optionalString(args, 'to');
  const rootsFlag = optionalStringList(args, 'roots');
  const suffixFlag = optionalString(args, 'suffix');
  const hasCreateFlags =
    sourceFlag !== undefined ||
    fromFlag !== undefined ||
    toFlag !== undefined ||
    rootsFlag !== undefined ||
    suffixFlag !== undefined;

  if (project && server) {
    process.stderr.write('warning: both --project and --server given; --server wins, --project ignored\n');
  }

  let briefCreate: AgentParams['briefCreate'];

  if (!threadId) {
    // Early CLI-level validation (livelier hints); runAgent re-validates at the
    // library layer.
    if (ct !== 'chat' && ct !== 'brief' && ct !== 'patch' && ct !== 'ask') {
      throw new CliError(
        'INVALID_ARGS',
        '--ct must be chat|brief|patch|ask (or pass --thread <id> to continue a thread)',
      );
    }
    if (ct === 'patch') {
      throw new CliError(
        'INVALID_ARGS',
        'c4s agent cannot create a patch thread; pass --thread <id> to continue one',
      );
    }
    if (ct === 'brief') {
      // --brief (attach-mode) XOR --source/--from/--to/--roots/--suffix (create-mode).
      if (briefPath && hasCreateFlags) {
        throw new CliError(
          'INVALID_ARGS',
          '--ct brief: --brief (attach) and --source/--from/--to/--roots/--suffix (create) are mutually exclusive',
        );
      }
      if (!briefPath && !hasCreateFlags) {
        throw new CliError(
          'INVALID_ARGS',
          '--ct brief requires either --brief <path> (attach) or --source <release-diff|initial|analysis> (create)',
        );
      }
      if (hasCreateFlags) {
        const cliSource = sourceFlag ?? 'release-diff';
        if (cliSource === 'release-diff') {
          if (!fromFlag || !toFlag) {
            throw new CliError(
              'INVALID_ARGS',
              "--source release-diff requires both --from <release> and --to <release>",
            );
          }
          briefCreate = {
            source: 'release-diff',
            fromReleaseName: fromFlag,
            toReleaseName: toFlag,
            roots: rootsFlag,
            suffix: suffixFlag,
          };
        } else if (cliSource === 'initial') {
          if (!toFlag) {
            throw new CliError('INVALID_ARGS', '--source initial requires --to <release>');
          }
          if (fromFlag) {
            throw new CliError(
              'INVALID_ARGS',
              '--source initial does not accept --from (fromReleaseName is always null)',
            );
          }
          briefCreate = {
            source: 'release-diff',
            fromReleaseName: null,
            toReleaseName: toFlag,
            roots: rootsFlag,
            suffix: suffixFlag,
          };
        } else if (cliSource === 'analysis') {
          if (rootsFlag) {
            throw new CliError('INVALID_ARGS', "--source analysis does not accept --roots");
          }
          if (toFlag) {
            throw new CliError(
              'INVALID_ARGS',
              '--source analysis does not accept --to (toReleaseName is always null)',
            );
          }
          briefCreate = {
            source: 'analysis',
            fromReleaseName: fromFlag ?? null,
            toReleaseName: null,
            suffix: suffixFlag,
          };
        } else {
          throw new CliError('INVALID_ARGS', '--source must be release-diff|initial|analysis');
        }
      }
    }
  }

  let result: { threadId: string; answer: string; briefPath?: string; messages?: AgentMessage[] };
  try {
    result = await runAgent({
      message,
      project,
      workspace,
      server,
      contextType: ct as AgentContextType | undefined,
      threadId,
      briefPath: briefCreate ? undefined : briefPath,
      briefCreate,
      effort: effort as 'low' | 'medium' | 'high' | undefined,
      output: 'full',
    });
  } catch (err) {
    if (err instanceof AgentError) {
      throw new CliError(err.code as CliErrorCode, err.message, err.hint);
    }
    throw err;
  }

  // --- output --------------------------------------------------------------
  if (args.format === 'text') {
    // Verbose: every message of the turn (text + reasoning + tool rows), then
    // the final answer; threadId hint on stderr.
    for (const m of result.messages ?? []) {
      process.stdout.write(formatMessage(m) + '\n');
    }
    process.stdout.write('\n' + result.answer + '\n');
    if (result.briefPath) {
      process.stdout.write(`brief: ${result.briefPath}\n`);
    }
    process.stderr.write(
      `thread: ${result.threadId} (continue: c4s agent "..." --thread ${result.threadId})\n`,
    );
  } else {
    process.stdout.write(
      JSON.stringify(
        {
          threadId: result.threadId,
          answer: result.answer,
          briefPath: result.briefPath,
          messages: result.messages ?? [],
        },
        null,
        2,
      ) + '\n',
    );
  }
}

/** Render one turn message for the verbose text output. */
function formatMessage(m: AgentMessage): string {
  const label = m.toolName ? `${m.role}/${m.toolName}` : m.role;
  const prefix = m.subagentTaskId ? `[${label} · sub]` : `[${label}]`;
  return `${prefix} ${extractText(m.content)}`;
}

/**
 * Reasoning + some tool rows persist `content` as `JSON.stringify({ text, ... })`.
 * Unwrap the `text` field for display; fall back to the raw string otherwise.
 */
function extractText(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      return parsed.thinking ? `(reasoning) ${parsed.text}` : parsed.text;
    }
  } catch {
    /* not JSON — raw content below */
  }
  return content;
}
