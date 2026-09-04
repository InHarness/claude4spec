import { describe, expect, it } from 'vitest';
import { resolvePluginSubagents } from '../../../src/server/services/plugin-subagents.js';
import { layeredSpecExplore as explorer } from '../src/subagents/layered-spec-explore.js';
import { layeredSpecReview as sub } from '../src/subagents/layered-spec-review.js';

/**
 * The reviewer half of the capability. Three claims are load-bearing and none of
 * them is visible by reading the entry casually: that the pair is separable by
 * description alone, that the rules are FETCHED rather than carried, and that the
 * three "I could not review" reports stay distinguishable from a clean one.
 */
describe('c4s-plugin-layered-vertical-slices — the reviewer it contributes', () => {
  it('does not collide with a reserved built-in name, nor with its own sibling', () => {
    expect(['spec-explore', 'diff-explore']).not.toContain(sub.name);
    expect(sub.name).not.toBe(explorer.name);
  });

  /**
   * The pair is HETEROGENEOUS and stands in the same turn, so `description` is the
   * ONLY thing routing between them — unlike the built-in pair, which `context_type`
   * separates. Overlapping descriptions here mean the model picks at random.
   */
  it('routes on a description that judges, against a sibling that locates', () => {
    expect(sub.description).toMatch(/judges|conform|DEVIATIONS/);
    expect(sub.description).toContain('JUST SAVED');
    // Each one says what it is NOT, in the other's terms.
    expect(sub.description).toContain('never when the question is where something lives');
    expect(explorer.description).toContain('LOCATES and does not judge');
    // It rules itself out in a project not written this way, like its sibling.
    expect(sub.description).toContain('Do NOT use it if this specification is not organised');
  });

  /**
   * One source for the rules. A `promptBody` that inlined them would enforce a
   * style the project may already have moved past — the failure is silent, which
   * is why it is asserted rather than reviewed.
   */
  it('fetches the rules instead of carrying them', () => {
    expect(sub.promptBody).toContain('load_skill_file');
    expect(sub.promptBody).toContain('SKILL.md');
    // The rules themselves — the vocabulary a copy of §6 would inevitably bring.
    expect(sub.promptBody).not.toContain('~250 lines');
    expect(sub.promptBody).not.toContain('## Module slice schema');
  });

  it('leaves the host frame its mechanics', () => {
    expect(sub.promptBody).not.toContain('truncated: true');
    expect(sub.promptBody).not.toContain('NEVER mutate');
    expect(sub.promptBody).not.toContain('Agent/Task');
  });

  /**
   * Three reports about the INPUT, each of which a reader would otherwise mistake
   * for a clean bill of health. This is the edge case the release names.
   */
  it('keeps "could not review" distinguishable from "nothing to fix"', () => {
    expect(sub.promptBody).toContain('No input');
    expect(sub.promptBody).toContain('Empty delta');
    expect(sub.promptBody).toContain('Partial review');
    expect(sub.promptBody).toContain('Never report it as a clean result');
  });

  /**
   * Exhaustion returns NOTHING — not a truncated report. A verdict composed at the end is
   * therefore lost whole, which makes incremental reporting the only way a long review
   * survives its own budget. The duty belongs in the body, not in the workflow: it governs
   * how the reviewer WORKS, not how the caller reads it.
   */
  it('obliges the reviewer to report incrementally, not to hold a verdict', () => {
    expect(sub.promptBody).toContain('Report INCREMENTALLY');
    expect(sub.promptBody).toMatch(/held to the end is lost whole/);
  });

  it('is offered in chat only — the one context its trigger lives in', () => {
    expect(sub.contextTypes).toEqual(['chat']);
  });

  it('attaches the style whose rules it judges by', () => {
    expect(sub.attachInternalSkills).toEqual(['layered-vertical-slices']);
  });

  it('declares the model, effort and turn budget of a bounded review', () => {
    expect(sub.model).toBe('sonnet');
    expect(sub.effort).toBe('medium');
    expect(sub.maxTurns).toBe(40);
  });

  /**
   * `release_diff` is the interesting entry: it reads as a release tool, and the
   * sanitizer is a blacklist on mutating VERBS rather than a whitelist, so this
   * proves the reviewer keeps it — and that the contribution grants nothing the
   * host's `chat` turn does not already mount.
   */
  it('survives the host sanitizer with release_diff intact', () => {
    const definitions = resolvePluginSubagents({
      contextType: 'chat',
      contributions: [sub],
      hasSkillSlug: (slug) => slug === 'layered-vertical-slices',
      taken: new Set(['spec-explore']),
      warn: () => {},
    });
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.tools).toEqual(sub.tools);
    expect(definitions[0]!.tools).toContain('mcp__release-tools__release_diff');
    expect(definitions[0]!.skills).toEqual(['layered-vertical-slices']);
    expect(definitions[0]!.prompt.startsWith('You are a read-only explorer subagent')).toBe(true);
    expect(definitions[0]!.prompt.endsWith(sub.promptBody)).toBe(true);
  });

  it('is absent from every context but chat', () => {
    for (const contextType of ['brief', 'patch', 'ask'] as const) {
      const definitions = resolvePluginSubagents({
        contextType,
        contributions: [sub],
        hasSkillSlug: () => true,
        taken: new Set(),
        warn: () => {},
      });
      expect(definitions).toEqual([]);
    }
  });

  /** Both contributions resolve side by side — the turn carries the pair, not a choice. */
  it('stands in the same turn as the explorer, both surviving the resolver', () => {
    const definitions = resolvePluginSubagents({
      contextType: 'chat',
      contributions: [explorer, sub],
      hasSkillSlug: (slug) => slug === 'layered-vertical-slices',
      taken: new Set(['spec-explore']),
      warn: () => {},
    });
    expect(definitions.map((d) => d.name)).toEqual([explorer.name, sub.name]);
  });
});
