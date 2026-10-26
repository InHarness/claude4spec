import type { ParsedArgs } from '../args.js';
import { optionalString, optionalStringList } from '../args.js';
import { CliError, type CliErrorCode } from '../errors.js';
import {
  AgentError,
  runAgent,
  type AgentContextType,
  type AgentMessage,
} from '../../../core/agent/run-agent.js';
import { parseModelFlag } from '../model-flag.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 * `c4s agent` — generic synchronous agent turn over any thread context (M11).
 *
 * The verbose, developer-facing surface: defaults to `output: 'full'`, so it
 * prints every message of the turn (assistant text + reasoning + tool rows)
 * before the final answer. Cienki wrapper nad `runAgent(...)`; warstwa CLI to
 * parsowanie flag, mapowanie kodow bledow na `CliError`, formatowanie outputu.
 *
 *   c4s agent "<msg>" --ct chat
 *   c4s agent "<msg>" --plan <planPath>        # new executor thread on an existing plan (—ct not needed)
 *   c4s agent "<msg>" --ct ask                 # read-only peer consult
 *   c4s agent "<msg>" --ct brief --brief <path>       # attach-mode
 *   c4s agent "<msg>" --ct brief                      # create-mode, window open to the current state
 *   c4s agent "<msg>" --ct brief --from <r> --to <r>  # create-mode, closed window
 *   c4s agent "<msg>" --ct brief --to <r>             # create-mode, window open at the start
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
  // The mode predicate is now a single condition (`--brief` present → attach),
  // so an EMPTY `--brief` would silently fall through to create-mode and mint a
  // brief nobody asked for — exactly what `--brief "$UNSET_VAR"` produces in a
  // script. Presence with no value is an argument error, not a create request.
  if (args.flags.has('brief') && briefPath === undefined) {
    throw new CliError('INVALID_ARGS', '--brief needs a path (got an empty value)');
  }
  const planPath = optionalString(args, 'plan');
  if (args.flags.has('plan') && planPath === undefined) {
    throw new CliError('INVALID_ARGS', '--plan needs a path (got an empty value)');
  }
  const server = optionalString(args, 'server');
  const effort = optionalString(args, 'effort');
  const model = parseModelFlag(args);
  const project = args.project;
  const workspace = args.workspace;

  // Create-mode flags (only meaningful for --ct brief); forwarded verbatim.
  // No provenance selector — provenance is the shape of the window, and these
  // two ends are the window.
  const fromFlag = optionalString(args, 'from');
  const toFlag = optionalString(args, 'to');
  const rootsFlag = optionalStringList(args, 'roots');
  const suffixFlag = optionalString(args, 'suffix');

  if (planPath !== undefined) {
    // Plan mode always creates a NEW chat thread, so continuation, a brief or
    // another context make no sense with it. `runAgent` re-checks the same
    // (it is the shared library); here only for the CLI-worded messages.
    if (threadId) {
      throw new CliError(
        'INVALID_ARGS',
        '--plan does not go with --thread; continue a plan thread with c4s agent "<msg>" --thread <id>',
      );
    }
    if (briefPath !== undefined) {
      throw new CliError('INVALID_ARGS', '--plan does not go with --brief');
    }
    if (ct !== undefined && ct !== 'chat') {
      throw new CliError('INVALID_ARGS', `--plan opens a chat thread; --ct ${ct} does not go with it`);
    }
  } else if (!threadId) {
    // Early CLI-level validation (livelier hints) ograniczona do samego `--ct`.
    // Predykat trybu (attach vs create) ORAZ mapowanie flag okna na cialo
    // requestu naleza do `runAgent` — wspolnej biblioteki obu transportow —
    // wiec CLI ich nie duplikuje.
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
      briefPath,
      planPath,
      // Create-payload przekazywany plasko, dokladnie tak jak `effort`.
      fromReleaseName: fromFlag,
      toReleaseName: toFlag,
      roots: rootsFlag,
      suffix: suffixFlag,
      effort: effort as 'low' | 'medium' | 'high' | undefined,
      model,
      output: 'full',
    });
  } catch (err) {
    if (err instanceof AgentError) {
      throw new CliError(err.code as CliErrorCode, err.message, err.hint, err.details);
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

export const agentCommand: CliCommandContribution = {
  name: 'agent',
  executionMode: 'server-delegating',
  flags: ['ct', 'brief', 'plan', 'thread', 'effort', 'model', 'from', 'to', 'roots', 'suffix'],
  errorCodes: [
    ...SERVER_DELEGATING_CODES,
    // 2.1.26 (M11 `g24dkd8t`) — the turn family's 409 for a `--thread`
    // continuation with a changed session config.
    'RESUME_CONFIG_LOCKED',
    'INVALID_ARGS',
    'VALIDATION',
    'BRIEF_NOT_FOUND',
    'BRIEF_SAME_RELEASE',
    'RELEASE_NOT_FOUND',
  ],
  handler: runAgentCmd,
};
