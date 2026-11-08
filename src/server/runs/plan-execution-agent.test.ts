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

  it('is version 5 (nosqcr6z, 2.1.74) and carries the minimal c4s version only', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('5');
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

/**
 * M55 `nosqcr6z`, `41d3hcq3` (2.1.68; 2.1.74: v5) — the human-decision operations
 * by name, and the minimal c4s version. v5 is v4's list without
 * `mark_patch_applied`, which left the catalog (M43 `rp99fpc1`).
 */
describe('agent definition "plan-execution" v5 (M55 nosqcr6z, 41d3hcq3)', () => {
  const content = PLAN_EXECUTION_AGENT.content;
  const lines = content.split('\n');
  const planCommand = lines.find((l) => l.startsWith('- With a plan:'))!.split('`')[1]!;
  const promptCommand = lines.find((l) => l.startsWith('- With a prompt:'))!.split('`')[1]!;

  it('[ac:ac-tresc-definicji-plan-execution-v3-wym] the v5 content names release_create and mark_plan_applied as operations the c4s turn does not perform', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('5');
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

  it('[ac:ac-tresc-definicji-plan-execution-v3-kaz] the v5 content ends the Run with an entry in `conflicts` when the turn asks about a human-decision operation', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('5');
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

  it('[section:nosqcr6z] v5 names release_create, release_restore, release_update, accept_shadow, mark_plan_applied, mark_brief_implemented and delete_thread — mark_patch_applied no longer', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('5');
    expect([...PLAN_EXECUTION_HUMAN_DECISION_OPERATIONS]).toEqual([
      'release_create',
      'release_restore',
      'release_update',
      'accept_shadow',
      'mark_plan_applied',
      'mark_brief_implemented',
      'delete_thread',
    ]);
    // The patch flag is the patch thread's own declaration: neither the rule nor either form of the turn's instruction forbids it.
    const rule = lines.find((l) => l.startsWith('- The c4s turn does not perform these operations:'))!;
    for (const text of [rule, planCommand, promptCommand, content]) {
      expect(text).not.toMatch(/\bmark_patch_applied\b/);
    }
  });

  it('[ac:ac-minimalna-wersja-c4s-definicji-plan-e] the minimal c4s version of v5 is a release containing `c4s register-home`', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('5');
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

/** M55 `fmzjz3kn` (2.1.68; unchanged in v5) — the obligations of a continuation Run. */
describe('agent definition "plan-execution" v5 — continuation Run (M55 fmzjz3kn)', () => {
  const content = PLAN_EXECUTION_AGENT.content;
  const lines = content.split('\n');
  const start = lines.findIndex((l) => l.startsWith('Continuation Run'));
  const end = lines.findIndex((l, i) => i > start && l === '');
  const section = lines.slice(start, end);

  it('[ac:ac-tresc-definicji-plan-execution-v4-kaz-2] the v5 content, under `continuation`, reads the parent\'s history as `git log <continuation.parentBaseSha>..HEAD`', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('5');
    expect(start).toBeGreaterThan(-1);
    expect(section[0]).toMatch(/when the Run context carries `continuation`/);
    const history = section.find((l) => l.includes('the parent\'s history'))!;
    expect(history).toMatch(/`git log <continuation\.parentBaseSha>\.\.HEAD`/);
    expect(history).toMatch(/HEAD is the parent's tip, so the range holds exactly the parent's commits/);
    expect(history).toMatch(/Do not parse the parent's record/);
    // The handoff is the other source; without it, the history is the only one.
    expect(section.some((l) => /`continuation\.parentHandoff`/.test(l))).toBe(true);
    const noHandoff = section.find((l) => l.includes('Without a parent\'s handoff'))!;
    expect(noHandoff).toMatch(/only from `git log <continuation\.parentBaseSha>\.\.HEAD`/);
  });

  it('[ac:ac-tresc-definicji-plan-execution-v4-kaz] the v5 content, under `continuation`, does not repeat the points the parent already did', () => {
    expect(PLAN_EXECUTION_AGENT.version).toBe('5');
    expect(start).toBeGreaterThan(-1);
    const next = section.find((l) => l.includes('Carry out the rest of the plan'))!;
    expect(next).toMatch(/the rest of the plan and the continuation instruction/);
    expect(next).toMatch(/Do not repeat the points the parent already did/);
    // The parent's conflicts are taken up only when the instruction resolves them, others are carried over.
    const conflicts = section.find((l) => l.includes('parent\'s `conflicts`'))!;
    expect(conflicts).toMatch(/only when the continuation instruction resolves it; otherwise move it into your own `conflicts`/);
    expect(section.some((l) => /Do not change the records of other Runs/.test(l))).toBe(true);
  });
});
