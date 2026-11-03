/**
 * M55 `e1dwekyc` — the fixed definition of the agent "plan-execution": a
 * constant of the master's package (L10 `yopfnuxs`: process lifetime, no key —
 * it carries no project's data —, created at module import, released
 * implicitly by GC). It is the default Run type of `run_remote` (spec-operation
 * `run-remote`), and it replaces the former definition "shadow".
 *
 * The minimal c4s version is the only version bound: no upper bound (an
 * incompatibility upwards surfaces as the Run's result). Every change of
 * `content` raises `version`. The Run contract is added by the runner
 * (`c4s-runner` `modules/M07-run-execution.md` #vcj5sll6), so the content does
 * not repeat it.
 */
export interface RunAgentDefinition {
  name: string;
  version: string;
  content: string;
  /** The lowest c4s version (exact semver) the definition works with. */
  minC4sVersion: string;
}

/** Name of the default Run type (`run_remote` without `agent`). */
export const DEFAULT_RUN_AGENT_NAME = 'plan-execution';

/**
 * The lowest c4s release in which both `c4s agent --plan … --project …` and the
 * server start with `--no-open` work, read from the code: `--no-open` is in
 * `src/bin/launch.ts` since before 2.1.11, and `c4s agent --plan` (which takes
 * `--project` like every command) arrived in 2.1.64 (CHANGELOG `[2.1.64]`,
 * `src/bin/c4s/commands/agent.ts` at the release commit). Nothing on either
 * path changed since.
 */
export const PLAN_EXECUTION_MIN_C4S_VERSION = '2.1.64';

export const PLAN_EXECUTION_AGENT: RunAgentDefinition = Object.freeze({
  name: DEFAULT_RUN_AGENT_NAME,
  version: '2',
  minC4sVersion: PLAN_EXECUTION_MIN_C4S_VERSION,
  content: [
    'You are the Run Agent: you execute a plan or a prompt over the specification of the whole workspace by running a c4s turn.',
    '',
    'Calling the c4s turn:',
    '- With a plan: `c4s agent "Execute the plan without asking questions; where a choice is open, follow the recommendation. Do not call mark_plan_applied." --plan <path> --project <projectId>`.',
    // ASSUMPTION:dev-5503 — `c4s agent` without `--plan` or `--thread` needs `--ct`; the spec form omits it.
    '- With a prompt: `c4s agent "<prompt> Do not call mark_plan_applied." --ct chat --project <projectId>`, without `--plan`.',
    '- Take `path` and `projectId` from the Run context. Do not pass `--server`: the c4s server finds the workspace registry itself.',
    '- The instruction for the c4s turn always forbids `mark_plan_applied`. The master marks the plan as applied after the shadow is accepted.',
    '- Choose `--model` and `--effort` for `c4s agent` yourself, from the models the c4s server offers for chat (a model outside them is refused before the turn starts).',
    '',
    'Continuation:',
    '- When the turn ends with a question, continue the same thread with `c4s agent "Act according to your recommendation." --thread <id>`.',
    '',
    'Deadline:',
    '- Watch the `deadline` from the Run context. Before it passes, leave your commits and a `partial` handoff: a Run stopped by its deadline leaves neither a result ref nor a record.',
    '',
    'Write boundaries:',
    '- You do not change the specification or the plan yourself. Only the c4s turn brings specification changes.',
    '- Commit only the specification changes the c4s turn made. The c4s turn does not commit, so you do, and every commit message carries the "why" of its change: the commit messages are the only account of the reasoning the reviewer of the shadow reads.',
    '- Do not commit files the c4s server wrote, such as `.gitignore`: they would block the accept of the shadow (ACCEPT_OUTSIDE_SPEC).',
    '- Do not commit any change of the plan file.',
    '',
    'Handoff:',
    '- Write the handoff according to the Run contract.',
  ].join('\n'),
});

/** The agent definitions the master knows, by name. */
export const RUN_AGENT_DEFINITIONS: Readonly<Record<string, RunAgentDefinition>> = Object.freeze({
  [PLAN_EXECUTION_AGENT.name]: PLAN_EXECUTION_AGENT,
});
