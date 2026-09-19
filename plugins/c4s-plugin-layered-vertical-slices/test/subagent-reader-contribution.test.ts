import { describe, expect, it } from 'vitest';
import { resolvePluginSubagents } from '../../../src/server/services/plugin-subagents.js';
import { composePart } from '../src/skills/layered-vertical-slices.js';
import { layeredSliceReader as sub } from '../src/subagents/layered-slice-reader.js';
import { layeredSpecScout as scout } from '../src/subagents/layered-spec-scout.js';

/**
 * The slice reader — one module, one topic. What is load-bearing: the scope is
 * by topic and one step on the edges (a module read whole exhausts the budget,
 * and exhaustion returns NOTHING), the dependency protocol is spliced from its
 * one source, and the report is incremental so a partial read still arrives.
 */
describe('c4s-plugin-layered-vertical-slices — the slice reader it contributes', () => {
  it('does not collide with a built-in name, nor with the scout', () => {
    expect(['spec-explore', 'diff-explore']).not.toContain(sub.name);
    expect(sub.name).toBe('layered-slice-reader');
    expect(sub.name).not.toBe(scout.name);
  });

  it('routes as a reader of ONE module, and rules itself out in a flat spec', () => {
    expect(sub.description).toContain('ONE module');
    expect(sub.description).toMatch(/one per module, in parallel/);
    expect(sub.description).toMatch(/does not search for modules/);
    expect(sub.description).toContain('Do NOT use it if this specification is not organised');
  });

  it('carries protocol 2, spliced from its part, and not the sweep', () => {
    expect(sub.promptBody).toContain(composePart('parts/reading-deps.md'));
    expect(sub.promptBody).toContain('## Cross-cutting reading protocol 2');
    expect(sub.promptBody).not.toContain('## Cross-cutting reading protocol 1');
    expect(sub.promptBody).not.toMatch(/<!--\s*include:/);
  });

  it('reads by topic against the layer schema, never the whole module', () => {
    const body = sub.promptBody;
    expect(body).toMatch(/by topic, never the whole module/);
    expect(body).toContain('get_page_outline');
    expect(body).toMatch(/`Cel` and `Domain`\*\* — always/);
    expect(body).toContain('## Module slice schema');
    // In a split module only the subpages of the touched layers.
    expect(body).toMatch(/only the subpages of the layers the topic touches/);
  });

  it('goes one step on the edges and never reads a neighbour whole', () => {
    expect(sub.promptBody).toMatch(/one step, both directions/i);
    expect(sub.promptBody).toContain('**Never read a neighbour whole**');
  });

  it('reports incrementally: facts, gaps, edges, and what it did not read', () => {
    const body = sub.promptBody;
    expect(body).toMatch(/as you go, not at the end/);
    for (const kind of ['**Fact**', '**Gap**', '**Edge**', '**Not read**']) {
      expect({ kind, present: body.includes(kind) }).toEqual({ kind, present: true });
    }
  });

  /** Declared, not leaned on — exhaustion reaches the parent as silence. */
  it('declares its turn budget explicitly', () => {
    expect(sub.maxTurns).toBe(40);
    expect(sub.model).toBe('sonnet');
  });

  it('is offered in the three current-spec contexts, never in brief', () => {
    expect(sub.contextTypes).toEqual(['chat', 'patch', 'ask']);
  });

  /** Finding modules is the scout's; a reader that can search widely wanders. */
  it('reads pages and entities but cannot sweep the corpus', () => {
    expect(sub.tools).toContain('mcp__reference-tools__get_sections');
    expect(sub.tools).toContain('mcp__entity-tools__list_entities');
    expect(sub.tools).not.toContain('mcp__reference-tools__search_pages');
    expect(sub.tools).not.toContain('mcp__reference-tools__list_pages');
  });

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
    expect(definitions[0]!.maxTurns).toBe(40);
    expect(definitions[0]!.prompt.endsWith(sub.promptBody)).toBe(true);
  });
});
