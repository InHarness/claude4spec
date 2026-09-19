import { describe, expect, it } from 'vitest';
import { resolvePluginSubagents } from '../../../src/server/services/plugin-subagents.js';
import { composePart } from '../src/skills/layered-vertical-slices.js';
import { layeredSpecScout as sub } from '../src/subagents/layered-spec-scout.js';

/**
 * The scout — where a topic lives, and nothing about what it says there. What is asserted here is the DIVISION OF
 * LABOUR the release rests on: the body carries orientation, the host frame
 * carries mechanics, and neither restates the other. A body that started
 * explaining truncation or the no-mutation rule would be duplication that drifts
 * the moment the host's copy changes.
 */
describe('c4s-plugin-layered-vertical-slices — the scout it contributes', () => {
  it('does not collide with a reserved built-in name', () => {
    // A collision is not an override: the host drops the contribution and warns.
    // `spec-explore` is exactly the name a well-meaning author would reach for.
    expect(['spec-explore', 'diff-explore']).not.toContain(sub.name);
  });

  it('routes on a description that names the organisation it knows', () => {
    // `description` is the WHOLE routing surface — the host does not rewrite it and
    // the parent's prompt names no subagent at all, so this prose is the only thing
    // that can win this scout a turn over the generic one.
    expect(sub.description).toContain('MXX-slug/LY-slug');
    expect(sub.description.toLowerCase()).toContain('read-only');
    // Nothing gates the contribution on the style being active, so a flat-spec
    // project sees it too — the description has to rule itself out there.
    expect(sub.description).toContain('Do NOT use it if this specification is not organised that way');
  });

  it('carries ORIENTATION in its body and leaves the mechanics to the host frame', () => {
    expect(sub.promptBody).toContain('MXX-slug');
    expect(sub.promptBody).toContain('LY-slug');
    // Mechanics the frame owns. Restating them here is the failure mode.
    expect(sub.promptBody).not.toContain('truncated: true');
    expect(sub.promptBody).not.toContain('NEVER mutate');
    expect(sub.promptBody).not.toContain('Agent/Task');
  });

  /**
   * The layer model the style itself holds: a layer is a convention several
   * modules share, with a file of its own that fixes the slice's shape. The
   * earlier "a cut inside one module, never spans modules" contradicted it and
   * sent the scout past `layers/` altogether.
   */
  it('describes a layer the way the style does — a shared convention with its own file', () => {
    expect(sub.promptBody).toContain('layers/LY-slug');
    expect(sub.promptBody).toContain('## Module slice schema');
    expect(sub.promptBody).toContain('modules/MXX-slug/LY-slug');
    expect(sub.promptBody).not.toMatch(/never spans modules/);
    expect(sub.promptBody).not.toMatch(/not files of their own/);
  });

  it('is the scout, under its own name, and locates rather than reads', () => {
    expect(sub.name).toBe('layered-spec-scout');
    // It locates and returns a selection; reading is the slice reader's job.
    expect(sub.description).toMatch(/does NOT read module content/);
    expect(sub.description).toMatch(/does NOT judge/);
  });

  it('can read the tag vocabulary — the specification\'s own words for its subjects', () => {
    expect(sub.tools).toContain('mcp__reference-tools__list_tags');
  });

  /**
   * The procedure is the contract with `workflows/read.md`: terms first, the
   * index and tags, ONE map-mode regex, at most two rounds, entity → module, and
   * a cut into involved/periphery with a fallback when nothing is found.
   */
  it('carries the search procedure, in order, with its two-round ceiling', () => {
    const body = sub.promptBody;
    const steps = ['1. **Terms.**', '2. **The index and the tags.**', '3. **Search, in map mode.**', '4. **A second round, at most.**', '5. **Entity to module.**', '6. **Select.**'];
    let at = -1;
    for (const step of steps) {
      const next = body.indexOf(step);
      expect({ step, found: next > at }).toEqual({ step, found: true });
      at = next;
    }
    expect(body).toContain('ONE regex');
    expect(body).toMatch(/Two rounds, never three/);
    expect(body).toMatch(/At most about six/);
    expect(body).toContain('find_references');
  });

  it('returns involved, periphery, glossary, open questions — and says so when coverage is thin', () => {
    const body = sub.promptBody;
    expect(body).toContain('MNN-slug — reason — layers — entities — hit anchors');
    expect(body).toContain('**Periphery**');
    expect(body).toContain("user's word → specification's word");
    expect(body).toContain('**Open questions**');
    // An empty list with no coverage line reads as "not covered" — a different claim.
    expect(body).toMatch(/"few hits" or "no hits"/);
  });

  /**
   * The zero-hit fallback is the purpose sweep, spliced from its one source —
   * the same bytes `workflows/plan.md` carries, never a hand-kept copy.
   */
  it('falls back to the purpose sweep, spliced from its part', () => {
    expect(sub.promptBody).toContain(composePart('parts/reading-sweep.md'));
    expect(sub.promptBody).toContain('## Cross-cutting reading protocol 1');
    expect(sub.promptBody).not.toContain('## Cross-cutting reading protocol 2');
    expect(sub.promptBody).not.toMatch(/<!--\s*include:/);
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
