/**
 * 0.2.18 — the two axes an envelope moves on, asserted separately because the
 * whole risk of the migration is confusing them.
 *
 * **Axis A, registration — per ENVELOPE, globally.** `ui-view` and
 * `design-system` reach the registry only through `registerPlugin` → fan-out to
 * `registerEntityModule`, never from the core bootstrap. They travel in one
 * envelope because `ui-view.designSystemSlug` declares `ref: 'design-system'` —
 * a fixed, single-target ref — so the target must exist from the first
 * registration, and unregistering the envelope takes both types down at once.
 *
 * **Axis B, activation — per PROJECT, per TYPE.** The `config.entities`
 * whitelist still operates on a single type. Deactivating `ui-view` must NOT
 * deactivate `design-system`, and vice versa, despite the shared envelope. This
 * is the assertion that would catch someone "simplifying" activation to work on
 * the envelope, which is the natural mistake once the two ship together.
 *
 * Driven through the real loader against the real `plugins/` tree — a fixture
 * envelope would prove the machinery and not the wiring, and the wiring is what
 * changed.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRegistry, SkillResolver, findSkillsRoots } from '../../../src/server/services/skill-registry.js';
import { loadBuiltinEnvelopes } from '../../../src/server/core/plugin-host/loader.js';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/serialization/registerAll.js';

const ENVELOPE = 'c4s-plugin-frontend-mockups';
const PAIR = ['design-system', 'ui-view'];

async function loadedRegistry(): Promise<PluginRegistryImpl> {
  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  await loadBuiltinEnvelopes(registry);
  return registry;
}

describe('axis A — registration is per envelope', () => {
  let registry: PluginRegistryImpl;
  beforeAll(async () => {
    registry = await loadedRegistry();
  });

  it('the core bootstrap alone contributes neither type', () => {
    // `registerAllPlugins` is the whole of tier (a). If either type came back
    // into it, this is where a "convenient" import would show up.
    const coreOnly = new PluginRegistryImpl();
    registerAllPlugins(coreOnly);
    const types = coreOnly.listAvailable().map((m) => m.type).sort();
    expect(types).toEqual(['ac', 'diagram']);
  });

  it('both types arrive through the envelope loader', () => {
    const types = registry.listAvailable().map((m) => m.type);
    for (const type of PAIR) expect(types).toContain(type);
  });

  it('both are contributed by the SAME envelope — the ref pair is not split', () => {
    const record = registry.listPluginRecords().find((p) => p.name === ENVELOPE);
    expect(record, `${ENVELOPE} is not registered`).toBeDefined();
    expect([...record!.contributedTypes].sort()).toEqual(PAIR);

    // And no OTHER envelope claims either of them — a split across two records
    // is exactly what the ref pairing rule forbids.
    for (const other of registry.listPluginRecords().filter((p) => p.name !== ENVELOPE)) {
      for (const type of PAIR) expect(other.contributedTypes).not.toContain(type);
    }
  });

  it('unregistering the envelope drops BOTH types, idempotently and without throwing', () => {
    const types = () => registry.listAvailable().map((m) => m.type);
    for (const type of PAIR) expect(types()).toContain(type);

    registry.unregisterPlugin(ENVELOPE);
    for (const type of PAIR) expect(types()).not.toContain(type);
    // The other envelopes are untouched — teardown is per envelope, not global.
    expect(types()).toContain('endpoint');

    // Second call is a no-op. Since 0.2.29 no envelope declares `onUnregister`
    // at all — the slot is optional and only for resources the host cannot see,
    // and these packages hold none — so both the teardown AND its idempotency
    // are entirely the registry's: `if (!record) return`, which this pins.
    expect(() => registry.unregisterPlugin(ENVELOPE)).not.toThrow();
    for (const type of PAIR) expect(types()).not.toContain(type);
  });
});

describe('axis B — activation is per project, per type', () => {
  let registry: PluginRegistryImpl;
  beforeAll(async () => {
    registry = await loadedRegistry();
  });

  it.each([
    ['design-system', 'ui-view'],
    ['ui-view', 'design-system'],
  ])('whitelisting %s leaves %s available but inactive', (kept, dropped) => {
    const host = registry.consolidate({ entities: [kept] });

    // Both are in the POOL — the envelope contributed them regardless.
    const available = host.listAvailable().map((m) => m.type);
    expect(available).toContain(kept);
    expect(available).toContain(dropped);

    // Only one is ACTIVE. This is the assertion the brief asks for by name.
    const active = host.listEntities().map((m) => m.type);
    expect(active).toEqual([kept]);
    expect(host.isActive(kept)).toBe(true);
    expect(host.isActive(dropped)).toBe(false);
  });

  it('an undefined whitelist activates both, as it does every other type', () => {
    const active = registry.consolidate(null).listEntities().map((m) => m.type);
    for (const type of PAIR) expect(active).toContain(type);
  });
});

/**
 * 0.2.32 — the axis the envelope grew: it contributes something that is not a
 * type.
 *
 * `ui-view-mockup-generator` reaches the agent through a chain with three links,
 * and only the middle one is obvious. The manifest fills `contributes.skills[]`;
 * the loader lowers it into the plugin record; and the M37 resolver picks it up
 * off `source: 'plugin'` ALONE — there is no entry for it in any context type's
 * `attachInternalSkills`, and adding one would be the wrong fix for a resolver
 * that stopped summing its third source.
 *
 * Driven through the real loader against the real `plugins/` tree for the same
 * reason as the axes above: a fixture would prove the machinery, and the wiring
 * is what changed.
 */
describe('axis A, continued — the envelope contributes a SKILL, not only types', () => {
  const SKILL = 'ui-view-mockup-generator';
  const CONTEXTS = ['chat', 'brief', 'patch', 'ask'] as const;
  /**
   * A real selectable writing style, so the `<project_skill/>` slot is genuinely
   * occupied. Since 0.2.57 it comes from an envelope rather than the bundled root —
   * which changes nothing here and is asserted in its own suite below.
   */
  const STYLE = 'layered-vertical-slices';

  /** A registry with the envelope's skills folded in the way `createProjectContext` folds them. */
  function skillRegistryWith(registry: PluginRegistryImpl, cwd: string): SkillRegistry {
    const skills = SkillRegistry.load(findSkillsRoots(cwd));
    for (const skill of registry.listSkills()) skills.addPluginSkill(skill);
    return skills;
  }

  let registry: PluginRegistryImpl;
  let tmp: string;

  beforeAll(async () => {
    registry = await loadedRegistry();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-envelope-skill-'));
    fs.mkdirSync(path.join(tmp, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude4spec', 'config.json'), JSON.stringify({ writingStyle: null }));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('the loader carries it off the manifest as a contextual plugin skill', () => {
    const contributed = registry.listSkills().filter((s) => s.slug === SKILL);
    expect(contributed).toHaveLength(1);
    expect(contributed[0].scope).toBe('contextual');
    expect(contributed[0].content.length).toBeGreaterThan(0);
  });

  it('the M37 registry files it under source "plugin"', () => {
    const skills = skillRegistryWith(registry, tmp);
    expect(skills.list().find((s) => s.slug === SKILL)?.source).toBe('plugin');
  });

  it.each(CONTEXTS)('rides the %s context\'s skill listing, with no attachInternalSkills entry', (contextType) => {
    // 0.2.36: the fan-out reaches the prompt as a LISTING ROW, not as a delivered
    // package. The attachment is unchanged; only what it costs is.
    const resolver = new SkillResolver(skillRegistryWith(registry, tmp), tmp);
    expect(resolver.resolveForContext(contextType).listing.map((s) => s.slug)).toContain(SKILL);
  });

  it.each(CONTEXTS)('never earns a <project_skill/> in %s — forcing belongs to the writing-style slot', (contextType) => {
    // 0.2.36: the block's occupant is a FIELD of its own (`writingStyle`), fed by
    // `config.writingStyle` alone — a contextual plugin skill cannot reach it by
    // carrying a scope. This has to hold WITH a style active, the only configuration
    // where a second writing-style entry could hide.
    fs.writeFileSync(
      path.join(tmp, '.claude4spec', 'config.json'),
      JSON.stringify({ writingStyle: STYLE }),
    );
    try {
      const { listing, writingStyle } = new SkillResolver(
        skillRegistryWith(registry, tmp),
        tmp,
      ).resolveForContext(contextType);
      expect(listing.map((s) => s.slug)).toContain(SKILL);
      expect(writingStyle?.slug).toBe(STYLE);
    } finally {
      fs.writeFileSync(path.join(tmp, '.claude4spec', 'config.json'), JSON.stringify({ writingStyle: null }));
    }
  });

  it('is visible in list() but never selectable as a writing style', () => {
    const skills = skillRegistryWith(registry, tmp);
    expect(skills.list().map((s) => s.slug)).toContain(SKILL);
    expect(skills.listSelectable().map((s) => s.slug)).not.toContain(SKILL);
    expect(skills.isSelectable(SKILL)).toBe(false);
  });

  it('comes down with the envelope — one unregister takes both types AND the skill', () => {
    // The unit of distribution is the whole contribution. Were the skill split
    // into an envelope of its own, this is where it would survive `ui-view` and
    // go on teaching an entity type that is no longer registered.
    registry.unregisterPlugin(ENVELOPE);
    expect(registry.listSkills().map((s) => s.slug)).not.toContain(SKILL);
    const types = registry.listAvailable().map((m) => m.type);
    for (const type of PAIR) expect(types).not.toContain(type);

    const resolver = new SkillResolver(skillRegistryWith(registry, tmp), tmp);
    for (const contextType of CONTEXTS) {
      expect(resolver.resolveForContext(contextType).listing.map((s) => s.slug)).not.toContain(SKILL);
    }
  });
});

/**
 * 0.2.57 — the CAPABILITY-class envelope, and the first plugin in this repo that
 * carries no entity type.
 *
 * Every envelope above travels as one package because its contributions are
 * COUPLED: `ui-view` declares a fixed ref at `design-system`, so splitting the
 * pair would cut the declaration. `c4s-plugin-layered-vertical-slices` travels
 * as one package for a different reason — its two contributions are one
 * authorial capability, writable and distributable by someone outside this repo.
 * The test is "could a stranger want to write this and give it to others?"; a
 * writing style passes it, an `endpoint`/`dto` pair does not.
 *
 * Driven through the real loader against the real `plugins/` tree for the same
 * reason as everything above it: a fixture would prove the machinery, and the
 * wiring is what changed.
 */
describe('the capability-class envelope — a plugin with no entity type', () => {
  const PKG = 'c4s-plugin-layered-vertical-slices';
  const STYLE = 'layered-vertical-slices';
  const SUBAGENT = 'layered-spec-explore';

  function skillRegistryWith(registry: PluginRegistryImpl, cwd: string): SkillRegistry {
    const skills = SkillRegistry.load(findSkillsRoots(cwd));
    for (const skill of registry.listSkills()) skills.addPluginSkill(skill);
    return skills;
  }

  let registry: PluginRegistryImpl;
  let tmp: string;

  beforeAll(async () => {
    registry = await loadedRegistry();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-capability-envelope-'));
    fs.mkdirSync(path.join(tmp, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude4spec', 'config.json'), JSON.stringify({ writingStyle: STYLE }));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('[ac:ac-manifest-koperty-c4s-plugin-layered-v] loads with an empty contributes.entities[] and registers no type', () => {
    const record = registry.listPluginRecords().find((r) => r.name === PKG);
    expect(record, `${PKG} did not load`).toBeDefined();
    expect(record!.contributedTypes).toEqual([]);
  });

  /**
   * The FLOOR invariant. A built-in envelope ships inside the host package, so it
   * loads with no `trustProjectPlugins` gate and its `hostApiVersion` agrees by
   * construction — which is what guarantees at least one style resolves in every
   * installation. `tmp` is a bare cwd with no `.claude/skills` of its own, so the
   * only thing that can put a style on this list is the envelope.
   */
  it('[ac:ac-koperta-wbudowana-rozwiazuje-sie-w-ka] resolves in a bare project, with no trust gate in the way', () => {
    const skills = skillRegistryWith(registry, tmp);
    expect(skills.isSelectable(STYLE)).toBe(true);
    expect(new SkillResolver(skills, tmp).resolveForContext('chat').writingStyle?.slug).toBe(STYLE);
  });

  /**
   * The bundled root did not merely stop being the style's home — it holds no
   * style at all now. The class stays legal and the root stays in the precedence
   * chain; nothing lives there.
   */
  it('is served as source "plugin", and no style is bundled any more', () => {
    const selectable = skillRegistryWith(registry, tmp).listSelectable();
    expect(selectable.find((s) => s.slug === STYLE)?.source).toBe('plugin');
    expect(selectable.filter((s) => s.source === 'bundled')).toEqual([]);
  });

  /**
   * Contributed as literals compiled into the envelope's module — the one real
   * cost difference against the disk roots, and the reason the sub-files come
   * back without a `path` to read them from.
   */
  it('carries its whole package in memory, addressed (slug, file)', () => {
    const resolved = skillRegistryWith(registry, tmp).resolve(STYLE);
    expect(resolved.metadata.source).toBe('plugin');
    expect(resolved.metadata.path).toBe('');
    expect(resolved.content.length).toBeGreaterThan(0);
    for (const file of ['workflows/brief.md', 'templates/module.md']) {
      expect(resolved.files[file]?.isText, file).toBe(true);
      expect(resolved.files[file]!.content.length, file).toBeGreaterThan(0);
    }
  });

  /**
   * The two slots are one capability, so they come down together. Separately they
   * lose their meaning: the subagent's `promptBody` REPLACES the parent's prompt,
   * so without the style it does not know what it is moving through — and the
   * style without it leaves the parent grepping.
   */
  it('[ac:ac-jedno-registry-unregisterplugin-c4s-p] one unregister takes the style AND the subagent', () => {
    expect(registry.listSkills().map((s) => s.slug)).toContain(STYLE);
    expect(registry.listPluginRecords().flatMap((r) => r.subagents).map((s) => s.name)).toContain(SUBAGENT);

    registry.unregisterPlugin(PKG);

    expect(registry.listSkills().map((s) => s.slug)).not.toContain(STYLE);
    expect(registry.listPluginRecords().flatMap((r) => r.subagents).map((s) => s.name)).not.toContain(SUBAGENT);
    expect(registry.listPluginRecords().map((r) => r.name)).not.toContain(PKG);
  });
});

/**
 * 0.2.65 — the FORM CLAUSE, asserted on the bytes the agent actually receives.
 *
 * M15 makes the writing style the owner of *where* a result lands, and the entity
 * type the owner of *when* content stops being prose or a fence — the promotion
 * threshold. From that split falls one content obligation on a style: wherever it
 * enumerates the admissible forms for recording something, the project entity is
 * listed as an equal beside prose, table and fence, ORDERING INCLUDED, because the
 * first form listed reads as the default.
 *
 * Nothing in the host enforces this — no M19 consistency rule parses a skill
 * package's prose, and none is proposed. A style missing the clause is an
 * INCOMPLETE STYLE, the same class of gap as a package with no `workflows/brief.md`.
 * That is exactly why these two live as tests: `layered-vertical-slices` is the
 * reference fulfilment of the clause, and the only thing standing between it and a
 * silent regression is this file.
 *
 * Resolved through the real registry rather than by reading the `.md` off the disk:
 * the package travels as literals compiled into the envelope, so the disk file is
 * an input to the build, not the thing `load_skill_file` serves. Reading it would
 * pass while the served bytes said something else.
 */
describe('the reference style fulfils the M15 form clause', () => {
  const STYLE = 'layered-vertical-slices';

  let resolved: ReturnType<SkillRegistry['resolve']>;

  beforeAll(async () => {
    const registry = await loadedRegistry();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-form-clause-'));
    try {
      const skills = SkillRegistry.load(findSkillsRoots(tmp));
      for (const skill of registry.listSkills()) skills.addPluginSkill(skill);
      resolved = skills.resolve(STYLE);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  /**
   * The enumeration is asserted as a LIST, by the position of two of its bullets.
   * That is a known cost, named here rather than discovered later: rewriting the
   * enumeration as running prose would not make this criterion false, it would make
   * it undecidable — and the fix then is to rewrite the criterion, not to delete it.
   */
  /**
   * Registry precedence is `project user > global user > plugin > bundled`, and a
   * `writing-style` skill in a user root is NOT filtered out the way a `contextual`
   * one is. On a machine that still carries `~/.claude/skills/layered-vertical-slices/`
   * — the style's pre-envelope home — every assertion below would pass against that
   * disk copy while the shipped envelope had regressed. Assert the source first, or
   * the whole describe proves nothing on exactly the machines that predate the move.
   */
  it('resolves the style from the envelope, not from a user root', () => {
    expect(resolved.metadata.source).toBe('plugin');
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic] lists the entity embed BEFORE the raw fence in the slice schema', () => {
    expect(resolved.metadata.source).toBe('plugin');
    const layer = resolved.files['templates/layer.md'];
    expect(layer?.isText).toBe(true);

    // Scoped to the enumeration under `## Module slice schema`: the same two
    // phrases recur further down the file, where their order says nothing.
    const schema = layer!.content.slice(layer!.content.indexOf('## Module slice schema'));
    const entity = schema.indexOf('- an embed of project entities,');
    const fence = schema.indexOf('- a fenced block (');

    expect(entity, 'the entity form is not enumerated as a bullet').toBeGreaterThan(-1);
    expect(fence, 'the fenced form is not enumerated as a bullet').toBeGreaterThan(-1);
    expect(entity).toBeLessThan(fence);
  });

  /**
   * A prohibition without a scope reads as a blanket, and then it APPEARS to
   * contradict any entity type whose promotion threshold admits the very content it
   * seems to forbid. The contradiction is only apparent — the split of ownership
   * settles it, not the order of blocks in the prompt — but it is the style author's
   * job to lift it, not the agent's in flight.
   */
  it('[ac:ac-load-skill-file-layered-vertical-slic-2] carries the no-code rule together with its scope', () => {
    const rule = resolved.content.slice(resolved.content.indexOf('## 6. Quality rules'));

    expect(rule).toContain('**No code, no tests, no build config.**');
    // The scope names what the prohibition does NOT cover — the canonical shape of
    // a contract, promoted by an active type — and it has to sit with the rule, not
    // somewhere else in the package.
    const prohibition = rule.indexOf('**No code, no tests, no build config.**');
    const scope = rule.indexOf('**Scope.**', prohibition);
    expect(scope, 'rule 6 states a prohibition with no scope').toBeGreaterThan(-1);
    // Guarded: §7 of this very SKILL.md permits retiring a rule number, and an
    // unguarded `-1` end would widen the slice to nearly the whole section — the
    // match could then be satisfied by text outside the scope paragraph entirely.
    const nextRule = rule.indexOf('\n7. ', scope);
    expect(nextRule, 'rule 7 no longer follows rule 6 — rescope this assertion').toBeGreaterThan(-1);
    expect(rule.slice(scope, nextRule)).toMatch(/not implementation/i);
  });

  /**
   * The clause binds the style WHEREVER it enumerates admissible forms — the
   * template was the loudest place, not the only one. SKILL.md §2 is read on every
   * use of the style (the template only when one is copied), and `bootstrap.md`
   * authors the very layer files the template shapes; either one listing the fence
   * ahead of the entity re-seeds the default the template edit removed.
   */
  it('orders the entity form ahead of the fence everywhere it enumerates forms', () => {
    const enumerations: Array<[string, string]> = [
      ['SKILL.md §2', resolved.content],
      ['workflows/bootstrap.md', resolved.files['workflows/bootstrap.md']?.content ?? ''],
    ];

    for (const [where, body] of enumerations) {
      const entity = body.indexOf('an embed of project entities');
      const fence = body.indexOf('a fenced schema');
      expect(entity, `${where} stopped naming the entity form`).toBeGreaterThan(-1);
      expect(fence, `${where} stopped naming the fenced form`).toBeGreaterThan(-1);
      expect(entity, `${where} lists the fence before the entity`).toBeLessThan(fence);
    }
  });
});
