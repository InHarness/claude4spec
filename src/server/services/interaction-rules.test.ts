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
