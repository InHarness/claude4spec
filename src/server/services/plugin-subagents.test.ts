import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateSubagents } from '@inharness-ai/agent-adapters';
import {
  resolvePluginSubagents,
  sanitizeSubagentDefinition,
  isMutatingMcpTool,
  hostFrame,
  NON_DELEGABLE_TOOLS,
  RESERVED_SUBAGENT_NAMES,
  DEFAULT_SUBAGENT_TURNS,
  MAX_SUBAGENT_TURNS,
  __resetSubagentWarnings,
} from './plugin-subagents.js';
import { TRANSAGENT_TOOL_FULL_NAME } from '../mcp/transagent-tools.js';
import type { PluginSubagentContribution } from '../../shared/plugin-host/manifest.js';

const contrib = (over: Partial<PluginSubagentContribution> = {}): PluginSubagentContribution => ({
  name: 'domain-explore',
  description: 'Explores the domain.',
  promptBody: 'Do the domain thing.',
  tools: ['mcp__reference-tools__get_page'],
  ...over,
});

/** Collect warnings instead of spamming the console, and assert on them. */
function sink() {
  const messages: string[] = [];
  return { warn: (m: string) => messages.push(m), messages };
}

const resolve = (
  contributions: PluginSubagentContribution[],
  over: Partial<Parameters<typeof resolvePluginSubagents>[0]> = {},
) => {
  const s = sink();
  const out = resolvePluginSubagents({
    contextType: 'chat',
    contributions,
    hasSkillSlug: () => true,
    taken: new Set(['spec-explore']),
    warn: s.warn,
    ...over,
  });
  return { out, messages: s.messages };
};

beforeEach(() => {
  __resetSubagentWarnings();
});

describe('isMutatingMcpTool — blacklist on the TOOL segment', () => {
  it('catches the four mutating prefixes', () => {
    for (const t of [
      'mcp__entity-tools__create_entities',
      'mcp__entity-tools__update_entities',
      'mcp__entity-tools__delete_entities',
      'mcp__endpoint-tools__link_dto',
    ]) {
      expect(isMutatingMcpTool(t)).toBe(true);
    }
  });

  /**
   * The regression guard that matters most. A `get_`/`list_` WHITELIST would read as an
   * equivalent simplification and would strip every one of these — each of which a
   * built-in explorer depends on to do its job.
   */
  it('keeps read tools whose names do not begin with get_/list_', () => {
    for (const t of [
      'mcp__release-tools__release_diff',
      'mcp__reference-tools__search_pages',
      'mcp__reference-tools__find_references',
      'mcp__reference-tools__check_consistency',
      'mcp__entity-tools__describe_entity_type',
      'mcp__skill-tools__load_skill_file',
      'mcp__reference-tools__get_page',
      'mcp__release-tools__release_show',
      'mcp__release-tools__release_list',
      'mcp__entity-tools__resolve_identity',
      'mcp__entity-tools__describe_types',
      'mcp__c4s-tools__overview',
    ]) {
      expect(isMutatingMcpTool(t)).toBe(false);
    }
  });

  /**
   * The finding that made the verb test per-segment rather than prefix-only: every one of
   * these is a real, mounted, WRITING tool in this repo, and a prefix test matches none of
   * them. `release_update` in particular lands in `brief`, right next to `diff-explore`.
   */
  it('catches a mutating verb that is not the first segment', () => {
    for (const t of [
      'mcp__release-tools__release_create',
      'mcp__release-tools__release_update',
      'mcp__reference-tools__tag_entity',
      'mcp__reference-tools__untag_entity',
      'mcp__plan-tools__mark_plan_applied',
      'mcp__patch-tools__file_patch',
      'mcp__brief-tools__update_brief',
      'mcp__plugin-srv__set_cell',
    ]) {
      expect(isMutatingMcpTool(t)).toBe(true);
    }
  });

  it('tests the tool segment, not the server name', () => {
    // A server called `link-tools` must not make its read tools look mutating.
    expect(isMutatingMcpTool('mcp__link-tools__get_links')).toBe(false);
    expect(isMutatingMcpTool('mcp__create-svc__list_things')).toBe(false);
  });

  it('survives a tool name containing __ and ignores non-MCP names', () => {
    expect(isMutatingMcpTool('mcp__srv__delete__thing')).toBe(true);
    expect(isMutatingMcpTool('Read')).toBe(false);
    expect(isMutatingMcpTool('mcp__incomplete')).toBe(false);
  });
});

describe('sanitizeSubagentDefinition', () => {
  it('subtracts every non-delegable primitive, warning rather than throwing', () => {
    const s = sink();
    const out = sanitizeSubagentDefinition(
      {
        name: 'x',
        description: 'd',
        prompt: 'p',
        tools: ['Read', 'Agent', 'Task', 'Skill', TRANSAGENT_TOOL_FULL_NAME],
      },
      s.warn,
    );
    expect(out.tools).toEqual(['Read']);
    expect(s.messages).toHaveLength(4);
  });

  it('is applied to the built-ins too — the ban is enforced by code, not review', () => {
    const s = sink();
    const out = sanitizeSubagentDefinition(
      { name: 'spec-explore', description: 'd', prompt: 'p', tools: ['Skill', 'Read'] },
      s.warn,
    );
    expect(out.tools).not.toContain('Skill');
  });

  it('leaves a definition with no toolset alone (omitted ≠ empty)', () => {
    const def = { name: 'x', description: 'd', prompt: 'p' };
    expect(sanitizeSubagentDefinition(def)).toBe(def);
  });

  it('drift guard: the hardcoded literal still matches the real tool name', () => {
    expect(NON_DELEGABLE_TOOLS).toContain(TRANSAGENT_TOOL_FULL_NAME);
  });
});

describe('resolvePluginSubagents — context-type selector', () => {
  it('omitting contextTypes means chat only, never "everywhere"', () => {
    const c = [contrib()];
    expect(resolve(c, { contextType: 'chat' }).out).toHaveLength(1);
    for (const ct of ['brief', 'patch', 'ask'] as const) {
      expect(resolve(c, { contextType: ct }).out).toHaveLength(0);
    }
  });

  it('an explicit list is honoured exactly', () => {
    const c = [contrib({ contextTypes: ['brief', 'ask'] })];
    expect(resolve(c, { contextType: 'brief' }).out).toHaveLength(1);
    expect(resolve(c, { contextType: 'ask' }).out).toHaveLength(1);
    expect(resolve(c, { contextType: 'chat' }).out).toHaveLength(0);
    expect(resolve(c, { contextType: 'patch' }).out).toHaveLength(0);
  });

  it('a filtered-out contribution is silent — the selector is not an error', () => {
    expect(resolve([contrib()], { contextType: 'brief' }).messages).toEqual([]);
  });
});

describe('resolvePluginSubagents — names', () => {
  it('reserves the host built-in names against any contribution', () => {
    for (const name of RESERVED_SUBAGENT_NAMES) {
      const { out, messages } = resolve([contrib({ name })]);
      expect(out).toHaveLength(0);
      expect(messages[0]!).toMatch(/collides with a built-in/);
    }
  });

  it('keeps the first by discovery order on a duplicate name', () => {
    const { out, messages } = resolve([
      contrib({ name: 'dup', promptBody: 'FIRST' }),
      contrib({ name: 'dup', promptBody: 'SECOND' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.prompt).toContain('FIRST');
    expect(messages.some((m) => /contributed more than once/.test(m))).toBe(true);
  });

  it('skips a malformed contribution without taking its siblings down', () => {
    const { out } = resolve([
      contrib({ name: '' }),
      { ...contrib({ name: 'ok' }), tools: undefined as unknown as string[] },
      contrib({ name: 'good' }),
    ]);
    expect(out.map((s) => s.name)).toEqual(['good']);
  });
});

describe('resolvePluginSubagents — host prompt frame', () => {
  it('prepends the frame and keeps the plugin body last', () => {
    const { out } = resolve([contrib({ promptBody: 'BODY-MARKER' })]);
    const prompt = out[0]!.prompt;
    expect(prompt.startsWith('You are a read-only explorer subagent')).toBe(true);
    expect(prompt.endsWith('BODY-MARKER')).toBe(true);
  });

  it('carries the four invariants a plugin cannot override', () => {
    const prompt = resolve([contrib()]).out[0]!.prompt;
    expect(prompt).toContain('NEVER mutate anything');
    expect(prompt).toContain('Report POINTERS, not dumps');
    expect(prompt).toContain('mcp__skill-tools__load_skill_file');
    expect(prompt).toMatch(/may not spawn another agent/);
  });

  /**
   * 0.2.57 — reacting to `truncated: true` is a property of the READ CHANNEL, not of
   * anyone's writing style, so the host states it once per definition instead of leaving
   * every plugin author to rediscover it. A contributed explorer holding `get_sections`
   * used to get no budget guidance at all.
   */
  it('carries the truncation protocol, so a plugin need not reimplement it', () => {
    const prompt = resolve([contrib({ promptBody: 'BODY-MARKER' })]).out[0]!.prompt;
    expect(prompt).toContain('truncated: true');
    expect(prompt).toContain('edges');
    expect(prompt).toMatch(/Do NOT repeat the same call/);
    // The body still comes last: the frame grew, it did not swallow the assignment.
    expect(prompt.indexOf('truncated: true')).toBeLessThan(prompt.indexOf('BODY-MARKER'));
  });

  it('renders every context type with no unexpanded template expression', () => {
    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
      expect(hostFrame(ct, DEFAULT_SUBAGENT_TURNS)).not.toMatch(/\$\{/);
      expect(hostFrame(ct, DEFAULT_SUBAGENT_TURNS)).toContain(ct);
    }
  });

  /**
   * The frame states the EFFECTIVE budget — what the loader settled on — not the number the
   * envelope proposed. A prompt obliging a subagent to report "before the budget runs out"
   * while naming a budget it does not have is worse than naming none.
   */
  it('states the effective turn budget, not the declared one', () => {
    expect(resolve([contrib({ maxTurns: 999 })]).out[0]!.prompt).toContain(
      `${MAX_SUBAGENT_TURNS} round-trips`,
    );
    expect(resolve([contrib()]).out[0]!.prompt).toContain(`${DEFAULT_SUBAGENT_TURNS} round-trips`);
    expect(resolve([contrib({ maxTurns: 999 })]).out[0]!.prompt).not.toContain('999');
  });

  /** One string composed once at dispatch — there is no channel to decrement it mid-run. */
  it('says the number is a constant for the run, not a countdown', () => {
    const prompt = resolve([contrib()]).out[0]!.prompt;
    expect(prompt).toMatch(/CONSTANT, not a countdown/);
  });
});

/**
 * The three non-failure guarantees. Each asserts BOTH that nothing threw AND that the
 * library's own pre-dispatch gate accepts the result — `validateSubagents` throws BEFORE
 * a run starts, so anything that trips it kills the entire turn rather than one
 * contribution. A warning alone is not evidence the turn survives.
 */
describe('resolvePluginSubagents — the turn must still START', () => {
  it('a duplicate name does not blow up the turn', () => {
    let out!: ReturnType<typeof resolvePluginSubagents>;
    expect(() => {
      out = resolve([contrib({ name: 'dup' }), contrib({ name: 'dup' })]).out;
    }).not.toThrow();
    expect(() => validateSubagents(out)).not.toThrow();
  });

  it('a mutating MCP tool is subtracted and the turn still starts', () => {
    const { out, messages } = resolve([
      contrib({ tools: ['mcp__entity-tools__create_entities', 'mcp__reference-tools__get_page'] }),
    ]);
    expect(out[0]!.tools).toEqual(['mcp__reference-tools__get_page']);
    expect(messages.some((m) => /mutating MCP tool/.test(m))).toBe(true);
    expect(() => validateSubagents(out)).not.toThrow();
  });

  it('Agent / Skill / runTransagent are subtracted and the turn still starts', () => {
    const { out } = resolve([
      contrib({ tools: ['Agent', 'Skill', TRANSAGENT_TOOL_FULL_NAME, 'Read'] }),
    ]);
    expect(out[0]!.tools).toEqual(['Read']);
    expect(() => validateSubagents(out)).not.toThrow();
  });

  it('maxTurns above the ceiling is clamped, never an error', () => {
    expect(resolve([contrib({ maxTurns: 999 })]).out[0]!.maxTurns).toBe(MAX_SUBAGENT_TURNS);
    expect(resolve([contrib({ maxTurns: 5 })]).out[0]!.maxTurns).toBe(5);
  });

  /** The ceiling is a clamp, not a rejection band: the boundary value is a legal budget. */
  it('maxTurns EQUAL to the ceiling passes through untouched', () => {
    expect(resolve([contrib({ maxTurns: MAX_SUBAGENT_TURNS })]).out[0]!.maxTurns).toBe(
      MAX_SUBAGENT_TURNS,
    );
  });

  /**
   * Omission is a legal declaration — "no opinion" — not a packaging defect, which is why
   * this asserts the silence as hard as it asserts the number. A warning here would train
   * plugin authors to write a value they have no basis for.
   */
  it('a contribution omitting maxTurns takes the host default, silently', () => {
    const { out, messages } = resolve([contrib()]);
    expect(out[0]!.maxTurns).toBe(DEFAULT_SUBAGENT_TURNS);
    expect(messages).toEqual([]);
  });

  /**
   * The other half of the same rule, and the reason the two cases are separate tests: a field
   * that is PRESENT but unusable is not an author declining to have an opinion, it is an
   * author who meant something and shipped it broken. The envelope crosses the boundary as
   * plain JSON, so `"40"` and `10.5` both arrive intact and both fail the guard. Silence here
   * would hide a packaging defect behind a plausible-looking 40-turn run.
   */
  it('a present but unusable maxTurns takes the default AND warns', () => {
    for (const bad of [-1, 0, NaN, 10.5, '40' as unknown as number]) {
      const { out, messages } = resolve([contrib({ maxTurns: bad })]);
      expect(out[0]!.maxTurns).toBe(DEFAULT_SUBAGENT_TURNS);
      expect(messages.join('\n')).toMatch(/unusable maxTurns/);
    }
  });
});

describe('resolvePluginSubagents — fan-out validation', () => {
  it('rejects the whole entry when model is outside the closed enum', () => {
    const { out, messages } = resolve([
      contrib({ name: 'bad', model: 'opus' as unknown as 'sonnet' }),
      contrib({ name: 'sibling' }),
    ]);
    // The sibling from the same package still registers — rejection is per entry.
    expect(out.map((s) => s.name)).toEqual(['sibling']);
    expect(messages.some((m) => /outside the allowed set/.test(m))).toBe(true);
  });

  it('accepts the two allowed models and passes effort through', () => {
    const { out } = resolve([contrib({ model: 'haiku', effort: 'low' })]);
    expect(out[0]!.model).toBe('haiku');
    expect(out[0]!.effort).toBe('low');
  });

  it('rejects the whole entry when effort is outside the closed enum', () => {
    const { out, messages } = resolve([
      contrib({ name: 'bad', effort: 'ultra' as unknown as 'low' }),
      contrib({ name: 'sibling' }),
    ]);
    expect(out.map((s) => s.name)).toEqual(['sibling']);
    expect(messages.some((m) => /effort "ultra"/.test(m))).toBe(true);
  });

  /* The manifest is plain JSON: none of these shapes is stopped by a type at the plugin
   * boundary, and each of them used to throw out of the resolver and take the turn down. */
  it('never throws on malformed field shapes, and keeps the siblings', () => {
    const { out } = resolve([
      contrib({ name: 'bad-tools', tools: [null, 123, 'mcp__reference-tools__get_page'] as unknown as string[] }),
      contrib({ name: 'bad-ctx', contextTypes: 'chat' as unknown as ('chat')[] }),
      contrib({ name: 'bad-skills', attachInternalSkills: 'x' as unknown as string[] }),
      contrib({ name: 'sibling' }),
    ]);
    expect(out.map((s) => s.name)).toEqual(['bad-tools', 'bad-skills', 'sibling']);
    expect(out[0]!.tools).toEqual(['mcp__reference-tools__get_page']);
    expect(out[1]!.skills).toBeUndefined();
  });

  it('drops an unknown skill slug but KEEPS the entry', () => {
    const { out, messages } = resolve([contrib({ attachInternalSkills: ['real', 'ghost'] })], {
      hasSkillSlug: (slug) => slug === 'real',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.skills).toEqual(['real']);
    expect(messages.some((m) => /unknown internal skill "ghost"/.test(m))).toBe(true);
  });

  it('omits skills entirely when every slug was unknown', () => {
    const { out } = resolve([contrib({ attachInternalSkills: ['ghost'] })], {
      hasSkillSlug: () => false,
    });
    expect(out[0]!.skills).toBeUndefined();
  });
});

describe('warn-once', () => {
  it('does not re-emit the same message on every turn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const args = {
        contextType: 'chat' as const,
        contributions: [contrib({ tools: ['Agent'] })],
        hasSkillSlug: () => true,
        taken: new Set<string>(),
      };
      resolvePluginSubagents(args);
      resolvePluginSubagents(args);
      resolvePluginSubagents(args);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
