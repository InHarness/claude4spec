import { describe, expect, it } from 'vitest';
import { resolvePluginSubagents } from '../../../src/server/services/plugin-subagents.js';
import { layeredSpecExplore as sub } from '../src/subagents/layered-spec-explore.js';

/**
 * The explorer half of the capability. What is asserted here is the DIVISION OF
 * LABOUR the release rests on: the body carries orientation, the host frame
 * carries mechanics, and neither restates the other. A body that started
 * explaining truncation or the no-mutation rule would be duplication that drifts
 * the moment the host's copy changes.
 */
describe('c4s-plugin-layered-vertical-slices — the subagent it contributes', () => {
  it('does not collide with a reserved built-in name', () => {
    // A collision is not an override: the host drops the contribution and warns.
    // `spec-explore` is exactly the name a well-meaning author would reach for.
    expect(['spec-explore', 'diff-explore']).not.toContain(sub.name);
  });

  it('routes on a description that names the organisation it knows', () => {
    // `description` is the WHOLE routing surface — the host does not rewrite it and
    // the parent's prompt names no subagent at all, so this prose is the only thing
    // that can win this explorer a turn over the generic one.
    expect(sub.description).toContain('MXX-slug/LY-slug');
    expect(sub.description.toLowerCase()).toContain('read-only');
  });

  it('carries ORIENTATION in its body and leaves the mechanics to the host frame', () => {
    expect(sub.promptBody).toContain('MXX-slug');
    expect(sub.promptBody).toContain('LY-slug');
    // Mechanics the frame owns. Restating them here is the failure mode.
    expect(sub.promptBody).not.toContain('truncated: true');
    expect(sub.promptBody).not.toContain('NEVER mutate');
    expect(sub.promptBody).not.toContain('Agent/Task');
  });

  it('is offered in the three current-spec contexts, never in brief', () => {
    // A brief turn explores a historical release diff, which is `diff-explore`'s job;
    // an explorer of the CURRENT spec there would break the brief's self-containment.
    expect(sub.contextTypes).toEqual(['chat', 'patch', 'ask']);
  });

  it('attaches the style it is oriented by, so the conventions are one call away', () => {
    expect(sub.attachInternalSkills).toEqual(['layered-vertical-slices']);
  });

  /**
   * `tools` is a SELECTION over the host's delegable set, never a grant. Passing the
   * real contribution through the real resolver is what proves nothing in it is
   * mutating or non-delegable — a hand-read of the array would not.
   */
  it('survives the host sanitizer with its toolset intact', () => {
    const definitions = resolvePluginSubagents({
      contextType: 'chat',
      contributions: [sub],
      hasSkillSlug: (slug) => slug === 'layered-vertical-slices',
      taken: new Set(['spec-explore']),
      warn: () => {},
    });
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.tools).toEqual(sub.tools);
    expect(definitions[0]!.skills).toEqual(['layered-vertical-slices']);
    // The frame is prepended and the body stays last.
    expect(definitions[0]!.prompt.startsWith('You are a read-only explorer subagent')).toBe(true);
    expect(definitions[0]!.prompt.endsWith(sub.promptBody)).toBe(true);
  });
});
