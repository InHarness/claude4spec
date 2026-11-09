import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPluginTestApp, type PluginTestApp } from '../../../tests/helpers/plugin-test-setup.js';
import { hostProjectTypeRegistry } from '../project-types/registry.js';
import { projectCapabilitySet } from '../project-types/capabilities.js';
import { KNOWN_CONTEXT_TYPES, subagentsFor } from './chat-context.js';
import type { ChatContextType } from '../../shared/entities.js';

/**
 * 2.1.77 (M45 `37ogwcgx`, Odczyt możliwości) — the built-in subagents follow the
 * project's capability set. A `skill` project has neither `entities` nor
 * `briefs`: `spec-explore`'s MCP allow-list is the `reference-tools` rows of the
 * definition table (plus the skill channel) and nothing from an entity server,
 * and `diff-explore` is never built — no turn of the project carries it.
 * Proven on a real `skill` project context (its plugin host, its registered
 * context types), against a `spec` control.
 */
describe('M45 subagents in a `skill` project (2.1.77)', () => {
  let skill: PluginTestApp;
  let spec: PluginTestApp;
  const capsOf = (slug: string) => projectCapabilitySet(hostProjectTypeRegistry().get(slug)!.capabilities);

  beforeAll(async () => {
    skill = await createPluginTestApp([], { projectType: 'skill' });
    spec = await createPluginTestApp([]);
  }, 120_000);

  afterAll(async () => {
    await skill?.cleanup();
    await spec?.cleanup();
  });

  const entityServerTool = (tool: string) =>
    tool.startsWith('mcp__entity-tools__') ||
    tool === 'mcp__reference-tools__find_references' ||
    // a per-type entity server (`<type>-tools`) of any type in the pool
    spec.host.listAvailable().some((m) => tool.startsWith(`mcp__${m.type}-tools__`));

  it('[ac:ac-w-projekcie-typu-skill-allow-lista-de] in a `skill` project the `spec-explore` allow-list contains no tool of an entity server', () => {
    const caps = capsOf('skill');
    expect(caps.has('entities')).toBe(false);
    for (const ct of skill.contextTypes as ChatContextType[]) {
      const explore = subagentsFor(ct, skill.host, false, () => true, undefined, caps).find((s) => s.name === 'spec-explore');
      expect(explore, ct).toBeDefined();
      const tools = explore!.tools ?? [];
      expect(tools.filter(entityServerTool), ct).toEqual([]);
      // What stays: the `reference-tools` reads of the definition table.
      expect(tools).toEqual(
        expect.arrayContaining([
          'mcp__reference-tools__list_pages',
          'mcp__reference-tools__search_pages',
          'mcp__reference-tools__get_page',
          'mcp__reference-tools__get_sections',
          'mcp__reference-tools__get_page_outline',
          'mcp__reference-tools__check_consistency',
        ]),
      );
      expect(explore!.prompt).not.toContain('get_entities');
    }
    // Control: a `spec` project's `spec-explore` reads the entity graph.
    const specTools =
      subagentsFor('chat', spec.host, false, () => true, undefined, capsOf('spec')).find((s) => s.name === 'spec-explore')!
        .tools ?? [];
    expect(specTools).toEqual(
      expect.arrayContaining(['mcp__entity-tools__get_entities', 'mcp__reference-tools__find_references']),
    );
  });

  it('[ac:ac-w-projekcie-typu-skill-tablica-subage] in a `skill` project the `subagents` array of no turn contains the `diff-explore` definition', () => {
    const caps = capsOf('skill');
    expect(caps.has('briefs')).toBe(false);
    // Every turn the project can run is one of its registered context types…
    expect(skill.contextTypes).not.toContain('brief');
    for (const ct of skill.contextTypes as ChatContextType[]) {
      const names = subagentsFor(ct, skill.host, false, () => true, undefined, caps).map((s) => s.name);
      expect(names, ct).not.toContain('diff-explore');
      expect(names, ct).toContain('spec-explore');
    }
    // …and even asked for the code map's every row, the definition is not built.
    for (const ct of KNOWN_CONTEXT_TYPES) {
      expect(subagentsFor(ct, skill.host, false, () => true, undefined, caps).map((s) => s.name), ct).not.toContain(
        'diff-explore',
      );
    }
    // Control: a `spec` project's `brief` turn carries it.
    expect(subagentsFor('brief', spec.host, false, () => true, undefined, capsOf('spec')).map((s) => s.name)).toContain(
      'diff-explore',
    );
  });
});
