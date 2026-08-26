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
   * 0.2.50 — the brief rules no longer claim there is no filesystem access, and
   * the claim's removal is a correction rather than a relaxation.
   *
   * `disallowedTools` is set NOWHERE in production code, and the `brief` profile
   * has `builtinPosture: 'follow-thread'` — so the built-in file tools were
   * available all along. Worse, the claim ran in the opposite direction too:
   * `resolveAgentExecutionScope` reaches `baseExecuteArgs` for every context
   * type, so a brief thread DID have a path scope and was told nothing about it.
   * The agent was forbidden what it could do and unaware of what bound it. The
   * frame now emits `<agent_path_scope>` and the rules point at it.
   */
  it('brief: claims no filesystem ban that nothing enforces', () => {
    const rules = INTERACTION_RULES.brief;
    expect(rules).not.toContain('NO filesystem access');
    expect(rules).not.toContain('no Read/Write/Edit/Glob/Grep/Bash');
    expect(rules).toContain('<agent_path_scope/>');
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
