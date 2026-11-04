/**
 * M55 `e1dwekyc` (2.1.68: subsections `fmzjz3kn`, `nosqcr6z`, `41d3hcq3`,
 * `6nyj9gs2`, `0e8792bl`) — the fixed definition of the agent "plan-execution": a
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
 * The lowest c4s release in which `c4s agent --plan … --project …`, the server
 * start with `--no-open`, `c4s register-home` and `c4s confirm-skill-uses` all
 * work (M55 `nosqcr6z`), read from the code: `--no-open` is in
 * `src/bin/launch.ts` since before 2.1.11, `c4s agent --plan` arrived in 2.1.64
 * (CHANGELOG `[2.1.64]`), and the two registry commands
 * (`src/bin/c4s/commands/register-home.ts`, `confirm-skill-uses.ts`) arrive
 * with the release implementing specification 2.1.67 — the package version
 * follows the specification release it implements, as 2.1.64 did.
 *
 * ASSUMPTION:dev-6707 — the first c4s release carrying the registry commands is
 * numbered 2.1.67; `package.json` still reads 2.1.64 (2.1.65–2.1.66 were not
 * published), so the number is not yet fixed by a published release.
 */
export const PLAN_EXECUTION_MIN_C4S_VERSION = '2.1.67';

/**
 * M55 `nosqcr6z` — the operations of the human-decision catalog (M43
 * `rp99fpc1`, tag `decyzja-czlowieka`) as they stand at version `4` (the same
 * membership as version `3`), named in the definition's content one by one. A SNAPSHOT, not a
 * read of the catalog: the Run Agent and the turn in the container do not
 * read the master's specification, so they never see the tag. A change of the
 * catalog's membership raises `version`.
 */
export const PLAN_EXECUTION_HUMAN_DECISION_OPERATIONS: readonly string[] = Object.freeze([
  'release_create',
  'release_restore',
  'release_update',
  'accept_shadow',
  'mark_plan_applied',
  'mark_brief_implemented',
  'mark_patch_applied',
  'delete_thread',
]);

const FORBIDDEN = PLAN_EXECUTION_HUMAN_DECISION_OPERATIONS.join(', ');

export const PLAN_EXECUTION_AGENT: RunAgentDefinition = Object.freeze({
  name: DEFAULT_RUN_AGENT_NAME,
  version: '4',
  minC4sVersion: PLAN_EXECUTION_MIN_C4S_VERSION,
  content: [
    'You are the Run Agent: you execute a plan or a prompt over the specification of the whole workspace by running a c4s turn.',
    '',
    'Operations of human decision:',
    `- The c4s turn does not perform these operations: ${FORBIDDEN}. Triggering any of them is a human's decision, made on the master after the shadow is accepted.`,
    '',
    'Calling the c4s turn:',
    `- With a plan: \`c4s agent "Execute the plan; do not perform the operations: ${FORBIDDEN}. When the plan or the turn needs one of them, end the turn with a question." --plan <path> --project <projectId>\`.`,
    // ASSUMPTION:dev-5503 — `c4s agent` without `--plan` or `--thread` needs `--ct`; the spec form omits it.
    `- With a prompt: \`c4s agent "<prompt> Do not perform the operations: ${FORBIDDEN}. When the prompt or the turn needs one of them, end the turn with a question." --ct chat --project <projectId>\`, without \`--plan\`.`,
    '- Take `path` and `projectId` from the Run context. Do not pass `--server`: the c4s server finds the workspace registry itself.',
    '- The instruction for the c4s turn always forbids every operation of the list above, mark_plan_applied and release_create among them. The master marks the plan as applied after the shadow is accepted.',
    '- Choose `--model` and `--effort` for `c4s agent` yourself, from the models the c4s server offers for chat (a model outside them is refused before the turn starts).',
    '',
    'Continuing the turn\'s thread:',
    '- When the turn ends with a question about an operation of the list above, do not continue the thread: stop the work on that point of the plan, write the turn\'s question and the operation into `conflicts` of the handoff, and end the Run according to the Run contract.',
    '- When the turn ends with any other question, continue the same thread with `c4s agent "Act according to your recommendation." --thread <id>`.',
    '',
    'Continuation Run (when the Run context carries `continuation`):',
    '- Establish what is already done from two sources:',
    '  - the parent\'s handoff `continuation.parentHandoff`: its summary, decisions, `conflicts` and `commits`;',
    '  - the parent\'s history `git log <continuation.parentBaseSha>..HEAD`. The runner fills `continuation.parentBaseSha` with the `baseSha` of the parent\'s record; at your start HEAD is the parent\'s tip, so the range holds exactly the parent\'s commits. Do not parse the parent\'s record.',
    '  - The work of earlier ancestors is known from the parent\'s handoff, which describes it.',
    '- Carry out the rest of the plan and the continuation instruction. Do not repeat the points the parent already did.',
    '- Take up a point from the parent\'s `conflicts` only when the continuation instruction resolves it; otherwise move it into your own `conflicts`.',
    '- Without a parent\'s handoff (a `failed` parent without a handoff), establish what is done only from `git log <continuation.parentBaseSha>..HEAD`.',
    '- Do not change the records of other Runs: the Run contract forbids it.',
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
    '- Where this definition contradicts a prohibition of the Run contract, the Run contract\'s prohibition holds.',
  ].join('\n'),
});

/** The agent definitions the master knows, by name. */
export const RUN_AGENT_DEFINITIONS: Readonly<Record<string, RunAgentDefinition>> = Object.freeze({
  [PLAN_EXECUTION_AGENT.name]: PLAN_EXECUTION_AGENT,
});
