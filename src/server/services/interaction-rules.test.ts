/**
 * The domain rules of each interaction type (0.2.19).
 *
 * These are prose, so the assertions are about what the split GUARANTEES rather
 * than about wording: which rules survive with no writing style selected, and
 * which concerns deliberately do NOT live here.
 */

import { describe, expect, it } from 'vitest';
import { INTERACTION_RULES } from './interaction-rules.js';
import { CONTEXT_TYPE_REGISTRY } from './chat-context.js';

describe('INTERACTION_RULES', () => {
  it('covers all four context types, and only `chat` is empty', () => {
    expect(Object.keys(INTERACTION_RULES).sort()).toEqual(['ask', 'brief', 'chat', 'patch']);
    expect(INTERACTION_RULES.chat).toBe('');
    for (const ct of ['brief', 'patch', 'ask'] as const) {
      expect(INTERACTION_RULES[ct].length).toBeGreaterThan(0);
    }
  });

  it('is what the context-type registry serves as dim 6', () => {
    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
      expect(CONTEXT_TYPE_REGISTRY[ct].interactionRules).toBe(INTERACTION_RULES[ct]);
    }
  });

  it('brief: carries the self-containment invariant, independent of any writing style', () => {
    // The whole point of the move. It used to be emitted by the prompt builder
    // beside genre rules that came from a skill; the two could drift, and a
    // project with no style got one without the other.
    const rules = INTERACTION_RULES.brief;
    expect(rules).toContain('TWO audiences');
    expect(rules).toContain('self-contained');
    expect(rules).toContain('Describe the SYSTEM, not the spec edits');
  });

  it('brief: states the narrow toolset and the single allowed plugin MCP', () => {
    const rules = INTERACTION_RULES.brief;
    expect(rules).toContain('release-tools');
    expect(rules).toContain('diff-explore');
  });

  /**
   * The brief rules must claim no filesystem ban that nothing enforces —
   * `disallowedTools` is set NOWHERE in production code and the `brief` profile has
   * `builtinPosture: 'follow-thread'`, so the file built-ins are available — and they
   * must not point at `<agent_path_scope/>` either. 0.2.50 swapped the false ban for
   * that pointer, but the brief frame does not emit the block: the pointer is a
   * dangling forward reference, the same class of falsehood from the other side. The
   * posture belongs in this text on its own terms — cwd, no writes by convention,
   * built-ins uncut, the brief edited through get_brief/update_brief.
   */
  it('brief: neither bans the filesystem nor points at a block its frame omits', () => {
    const rules = INTERACTION_RULES.brief;
    expect(rules).not.toContain('NO filesystem access');
    expect(rules).not.toContain('no Read/Write/Edit/Glob/Grep/Bash');
    expect(rules).not.toContain('agent_path_scope');
    expect(rules).toContain('get_brief');
    expect(rules).toContain('update_brief');
  });

  /**
   * 0.2.87 (M44): brief strips every built-in regardless of
   * `agent.disableDirectFilesystemAccess` (`PROFILES.brief.builtinTools = 'none'`), so
   * the rules may state the absence outright — it can no longer contradict `<builtin>`.
   */
  it('brief: states that no built-ins are held, pointing at <builtin>', () => {
    const rules = INTERACTION_RULES.brief;
    expect(rules).toContain('<builtin>');
    expect(rules).toContain('holds no built-in tools');
    expect(rules).toContain('write-denied at the sandbox level');
  });

  it('patch: says explicitly that it is NOT read-only, unlike brief', () => {
    const rules = INTERACTION_RULES.patch;
    expect(rules).toContain('NOT read-only');
    expect(rules).toContain('entity mutations');
  });

  it('ask: forbids mutation and forbids chaining to a further peer', () => {
    const rules = INTERACTION_RULES.ask;
    expect(rules).toContain('ANSWER, not a mutation');
    expect(rules).toMatch(/does NOT consult a further peer/);
  });

  /**
   * 2.1.9 — the code-snippet is the literal body of the block, so the whole text
   * is compared. The turn invariant changed: a request to change the
   * specification ends with a plan whose path the answer names RELATIVE to this
   * project; the old "a plan is the one thing this turn writes" sentence is gone.
   */
  it('[entity:szablon-interaction-context-ask] is the literal body of the snippet, with the plan-on-change turn invariant', () => {
    const expected = [
      'You are being CONSULTED by an agent working in another project. You are the specification of THIS project, answering as a peer.',
      '',
      'Identity:',
      '  - Answer FROM your own specification. Read it — do not reconstruct from memory, and do not fill a gap with what a system like this usually does. A confident invention is the one failure mode a consultation cannot survive: the caller has no way to check you.',
      '  - "The specification does not cover that" is a complete and useful answer. Give it, and point at the nearest thing that IS covered.',
      '',
      'Turn invariant:',
      "  - The output of this turn is an ANSWER, not a mutation. Pages and entities are exactly as they were when you were asked. A request to CHANGE this specification ends with a plan, never with an edit; your final answer names that plan's path relative to this project. You may also leave a plan when a proposal is too large for the answer.",
      '  - A question outside this specification\'s scope gets an honest "that is not a contract of this specification", plus a pointer to where the answer would live.',
      '',
      'No chaining:',
      '  - You are a leaf. A peer answering a consultation does NOT consult a further peer — answer from what you have, or say you cannot.',
    ].join('\n');
    expect(INTERACTION_RULES.ask).toBe(expected);
    expect(INTERACTION_RULES.ask).not.toContain('that is the one thing this turn writes');
  });

  it('leaves execution mechanisms to the registry — no rule restates plan mode or the MCP set', () => {
    // Mechanisms are ENFORCED by M05 (`builtinPosture`, `mcpServerSetForProfile`).
    // Restating them here as prose would create a second, unenforced description
    // that drifts the first time a profile changes.
    for (const ct of ['brief', 'patch', 'ask'] as const) {
      expect(INTERACTION_RULES[ct]).not.toContain('planMode');
      expect(INTERACTION_RULES[ct]).not.toContain('mcpServerSet');
    }
  });

  it('leaves methodology to the writing style, and says where it lives', () => {
    expect(INTERACTION_RULES.brief).toContain('workflows/brief.md');
    expect(INTERACTION_RULES.patch).toContain('workflows/patch.md');
  });
});
