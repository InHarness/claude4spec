import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_AGENT_NAME,
  PLAN_EXECUTION_AGENT,
  PLAN_EXECUTION_MIN_C4S_VERSION,
  RUN_AGENT_DEFINITIONS,
} from './plan-execution-agent.js';

/** M55 `e1dwekyc` (2.1.66) — the definition of the agent "plan-execution". */
describe('agent definition "plan-execution" (M55 e1dwekyc)', () => {
  const content = PLAN_EXECUTION_AGENT.content;

  it('is a frozen package constant named "plan-execution", the default Run type, and replaces "shadow"', () => {
    expect(PLAN_EXECUTION_AGENT.name).toBe('plan-execution');
    expect(DEFAULT_RUN_AGENT_NAME).toBe('plan-execution');
    expect(Object.isFrozen(PLAN_EXECUTION_AGENT)).toBe(true);
    expect(Object.keys(RUN_AGENT_DEFINITIONS)).toEqual(['plan-execution']);
    expect(RUN_AGENT_DEFINITIONS['plan-execution']).toBe(PLAN_EXECUTION_AGENT);
    expect(Object.hasOwn(RUN_AGENT_DEFINITIONS, 'shadow')).toBe(false);
  });

  it('raises `version` over the former "shadow" definition (version 1) and carries the minimal c4s version only', () => {
    expect(Number(PLAN_EXECUTION_AGENT.version)).toBeGreaterThan(1);
    expect(PLAN_EXECUTION_AGENT.minC4sVersion).toBe(PLAN_EXECUTION_MIN_C4S_VERSION);
    // The first c4s release with `c4s agent --plan … --project …`; `--no-open` predates it.
    expect(PLAN_EXECUTION_MIN_C4S_VERSION).toBe('2.1.64');
    expect(Object.keys(PLAN_EXECUTION_AGENT).sort()).toEqual(['content', 'minC4sVersion', 'name', 'version']);
  });

  it('describes the plan turn and the prompt turn through `c4s agent`, with path and projectId from the Run context and no --server', () => {
    expect(content).toMatch(/`c4s agent "[^"]*" --plan <path> --project <projectId>`/);
    const promptLine = content.split('\n').find((l) => l.startsWith('- With a prompt:'))!;
    expect(promptLine).toMatch(/c4s agent "<prompt>[^"]*"[^`]* --project <projectId>`/);
    expect(promptLine.split('`')[1]).not.toContain('--plan');
    expect(content).toMatch(/Take `path` and `projectId` from the Run context/);
    expect(content).toMatch(/Do not pass `--server`/);
    expect(content).not.toMatch(/--server </);
  });

  it('forbids mark_plan_applied in the c4s turn, leaves model and effort to the Run Agent, and continues the thread after a question', () => {
    expect(content).toMatch(/always forbids `mark_plan_applied`/);
    expect(content).toMatch(/--plan <path>[\s\S]*Do not call mark_plan_applied/);
    expect(content).toMatch(/Choose `--model` and `--effort`/);
    expect(content).toMatch(/ends with a question, continue the same thread with `c4s agent "[^"]*recommendation[^"]*" --thread <id>`/);
  });

  it('watches the deadline with a partial handoff, and sets the commit rules: only the c4s turn\'s spec changes, no server files, no plan file', () => {
    expect(content).toMatch(/Watch the `deadline` from the Run context\. Before it passes, leave your commits and a `partial` handoff/);
    expect(content).toMatch(/do not change the specification or the plan yourself\. Only the c4s turn brings specification changes/);
    expect(content).toMatch(/Commit only the specification changes the c4s turn made/);
    expect(content).toMatch(/every commit message carries the "why"/);
    expect(content).toMatch(/Do not commit files the c4s server wrote, such as `\.gitignore`/);
    expect(content).toMatch(/Do not commit any change of the plan file/);
    expect(content).toMatch(/handoff according to the Run contract/);
  });
});
