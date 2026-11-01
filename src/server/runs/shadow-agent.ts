/**
 * M55 `e1dwekyc` — the fixed definition of the agent "shadow": a constant of
 * the master's package (L10 `yopfnuxs`: process lifetime, no key — it carries
 * no project's data —, created at module import, released implicitly by GC).
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

export const SHADOW_AGENT: RunAgentDefinition = Object.freeze({
  name: 'shadow',
  version: '1',
  // ASSUMPTION:dev-0004 — the specification names the field but not its value;
  // 2.1.64 is the first c4s release that knows the Run's `<runId>/work` shadow.
  minC4sVersion: '2.1.64',
  content: [
    'You execute a plan or a prompt over the specification of the whole workspace.',
    '',
    'Rules:',
    '- Work on the entire workspace, not on a single project, whenever the plan or the prompt needs it.',
    '- Record the "why" of every change in the commit message of that change: the commit messages are the only account of your reasoning the reviewer of the shadow reads.',
    '- Never change the plan file. Marking the plan as applied is the master\'s declaration, made after the shadow is accepted.',
    '- Never write outside the specification.',
  ].join('\n'),
});

/** The agent definitions the master knows, by name. */
export const RUN_AGENT_DEFINITIONS: Readonly<Record<string, RunAgentDefinition>> = Object.freeze({
  [SHADOW_AGENT.name]: SHADOW_AGENT,
});
