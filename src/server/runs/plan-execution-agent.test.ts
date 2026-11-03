import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RUN_AGENT_NAME,
  PLAN_EXECUTION_AGENT,
  PLAN_EXECUTION_HUMAN_DECISION_OPERATIONS,
  PLAN_EXECUTION_MIN_C4S_VERSION,
  RUN_AGENT_DEFINITIONS,
} from './plan-execution-agent.js';
import { CATALOG, HUMAN_DECISION_TAG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { compareVersions } from './run-remote.js';
import { registerHomeCommand } from '../../bin/c4s/commands/register-home.js';
import { confirmSkillUsesCommand } from '../../bin/c4s/commands/confirm-skill-uses.js';

registerCoreOperations();

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

  it('is version 3 (nosqcr6z) and carries the minimal c4s version only', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('3');
    expect(PLAN_EXECUTION_AGENT.minC4sVersion).toBe(PLAN_EXECUTION_MIN_C4S_VERSION);
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

  it('leaves model and effort to the Run Agent, and continues the same thread after any other question, by the recommendation', () => {
    expect(content).toMatch(/Choose `--model` and `--effort`/);
    expect(content).toMatch(/ends with any other question, continue the same thread with `c4s agent "[^"]*recommendation[^"]*" --thread <id>`/);
  });

  it('puts the Run contract\'s prohibition above the definition where they contradict (0e8792bl)', () => {
    expect(content).toMatch(/contradicts a prohibition of the Run contract, the Run contract's prohibition holds/);
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

/** M55 `nosqcr6z`, `41d3hcq3` (2.1.67) — definition v3: the human-decision operations by name, and the minimal c4s version. */
describe('agent definition "plan-execution" v3 (M55 nosqcr6z, 41d3hcq3)', () => {
  const content = PLAN_EXECUTION_AGENT.content;
  const lines = content.split('\n');
  const planCommand = lines.find((l) => l.startsWith('- With a plan:'))!.split('`')[1]!;
  const promptCommand = lines.find((l) => l.startsWith('- With a prompt:'))!.split('`')[1]!;

  it('[ac:ac-tresc-definicji-plan-execution-v3-wym] the v3 content names release_create and mark_plan_applied as operations the c4s turn does not perform', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('3');
    const rule = lines.find((l) => l.startsWith('- The c4s turn does not perform these operations:'))!;
    expect(rule).toMatch(/\brelease_create\b/);
    expect(rule).toMatch(/\bmark_plan_applied\b/);
    // The instruction the c4s turn receives forbids them by name, in both forms of the call.
    for (const command of [planCommand, promptCommand]) {
      const forbidden = command.split(/do not perform the operations:/i)[1]!;
      expect(forbidden).toMatch(/\brelease_create\b/);
      expect(forbidden).toMatch(/\bmark_plan_applied\b/);
    }
    expect(planCommand).toMatch(/^c4s agent "[^"]+" --plan <path> --project <projectId>$/);
    expect(planCommand).toMatch(/end the turn with a question/);
  });

  it('[ac:ac-tresc-definicji-plan-execution-v3-kaz] the v3 content ends the Run with an entry in `conflicts` when the turn asks about a human-decision operation', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('3');
    const rule = lines.find((l) => l.includes('ends with a question about an operation of the list above'))!;
    expect(rule).toBeDefined();
    expect(rule).toMatch(/do not continue the thread/);
    expect(rule).toMatch(/write the turn's question and the operation into `conflicts` of the handoff/);
    expect(rule).toMatch(/end the Run according to the Run contract/);
    // Only the other questions continue the thread.
    expect(rule).not.toMatch(/--thread/);
  });

  it('[ac:ac-tresc-definicji-plan-execution-wymien] the content names every operation tagged decyzja-czlowieka at the release of its version', () => {
    const tagged = CATALOG.listTagged(HUMAN_DECISION_TAG).map((op) => op.name).sort();
    expect(tagged.length).toBeGreaterThan(0);
    // The snapshot in the content is the catalog at this version — a membership change must raise `version`.
    expect([...PLAN_EXECUTION_HUMAN_DECISION_OPERATIONS].sort()).toEqual(tagged);
    const rule = lines.find((l) => l.startsWith('- The c4s turn does not perform these operations:'))!;
    for (const name of tagged) {
      expect(rule, name).toMatch(new RegExp(`\\b${name}\\b`));
      expect(planCommand, name).toMatch(new RegExp(`\\b${name}\\b`));
      expect(promptCommand, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('[ac:ac-minimalna-wersja-c4s-definicji-plan-e] the minimal c4s version of v3 is a release containing `c4s register-home`', () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    // `register-home` (and `confirm-skill-uses`) are registered commands of this c4s.
    expect(registerHomeCommand.name).toBe('register-home');
    expect(confirmSkillUsesCommand.name).toBe('confirm-skill-uses');
    expect(fs.readFileSync(path.join(appRoot, 'src/bin/c4s.ts'), 'utf8')).toMatch(/^\s+registerHomeCommand,$/m);
    // The minimum is above the last release WITHOUT them (2.1.64, the published package before the commands)…
    expect(PLAN_EXECUTION_AGENT.minC4sVersion).toBe(PLAN_EXECUTION_MIN_C4S_VERSION);
    expect(compareVersions(PLAN_EXECUTION_MIN_C4S_VERSION, '2.1.64')).toBeGreaterThan(0);
    // …and is the release that carries them (ASSUMPTION:dev-6707: numbered after specification 2.1.67).
    expect(PLAN_EXECUTION_MIN_C4S_VERSION).toBe('2.1.67');
  });
});
