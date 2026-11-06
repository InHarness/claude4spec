import { hasServer } from '../glue.js';
import type { PromptBlock } from '../types.js';

/* M55 — Runs: how the chat agent orders, reports on and continues a Remote execution. */

/**
 * 2.1.70 (M55, L16) — the `<remote_execution>` block, verbatim from the
 * `szablon-remote-execution` code snippet. Static text: no placeholders, nothing
 * is filled per turn.
 */
export const REMOTE_EXECUTION_BLOCK = [
  "<remote_execution>",
  "run_remote, get_run and cancel_run start, report on and cancel a Remote execution (a Run): an agent turn executed on a runner host of this workspace.",
  "No result of a Remote execution is visible in this specification until the user reviews and accepts it in Releases.",
  "",
  "Starting",
  "  - Only at the user's request: a plan (the attached one by default, or a plan path), a prompt, or a continuation of an earlier Run. If it is unclear which, ask.",
  "  - Write the prompt, or a continuation's instruction, so that the Run completes the task on its own: give the goal and the context, ask for the work to be carried to the end with the Run's agent making its own decisions, and leave out any step that waits for a human decision. The user reviews those decisions when accepting the result.",
  "  - Leave the host out unless the user names one. On RUN_HOST_REQUIRED, show the hosts and ask the user to choose; report any other refusal as returned.",
  "  - Then give the runId and the host and hand the conversation back. Do not wait, and do not poll get_run.",
  "  - If the answer is unconfirmed, say the order may not have reached the host, and do not order it again unasked: a new run_remote starts a second Run.",
  "",
  "Reporting — only when asked",
  "  - Pass on get_run's state, outcome, reason and hints as returned, without reinterpreting them.",
  "  - resultSha decides whether there is a result: with it, say in which projects the result can be reviewed in Releases, or that it is already accepted or superseded; without it, say the Run left no result.",
  "",
  "Continuing",
  "  - Only a Run with resultSha can be continued (fromRunId, the user's additions as the instruction). For a Run without a result, or when run_remote refuses the continuation, offer a new Run instead.",
  "",
  "Never",
  "  - accept a result, or mark the plan as applied because a Run finished;",
  "  - call cancel_run unless the user asks to stop the Run.",
  "</remote_execution>",
].join('\n');

/**
 * Emission condition: the workspace has at least one runner-host record (M54) AND
 * `run-tools` is mounted in this turn. Deliberately independent of a host's
 * connection status and capabilities — those are momentary, and would make the
 * block appear and vanish between turns; a disconnected host or a missing
 * capability surfaces as the operation's refusal code instead.
 */
export function shouldEmitRemoteExecution(runnerHostCount: number, mountedServers: readonly { name: string }[]): boolean {
  return runnerHostCount >= 1 && hasServer(mountedServers, 'run-tools');
}

export const M55_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'remote_execution',
    render: (c) => (shouldEmitRemoteExecution(c.runnerHostCount, c.mcpInventory) ? REMOTE_EXECUTION_BLOCK : null),
  },
];
