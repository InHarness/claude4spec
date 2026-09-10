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
    // `registerAllPlugins` is the whole of tier (a), and as of 0.2.80 it holds
    // exactly ONE type. If any other came back into it, this is where a
    // "convenient" import would show up.
    const coreOnly = new PluginRegistryImpl();
    registerAllPlugins(coreOnly);
    const types = coreOnly.listAvailable().map((m) => m.type).sort();
    expect(types).toEqual(['diagram']);
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
 * off `source: 'plugin'` ALONE.
 *
 * 0.2.66: there is no `attachInternalSkills` map left to add an entry to, so the
 * fan-out is the only route there has ever been for this skill and is now the only
 * route there is for any. This envelope deliberately declares NO `contextTypes`,
 * which is why it stays in all four — a choice, not a missing mechanism.
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
   * occupied. Since 0.2.57 it comes from an envelope rather than the in-package
   * root — which changes nothing here and is asserted in its own suite below.
   */
  const STYLE = 'layered-vertical-slices';
  /** The sibling envelope's skill, which DOES narrow itself — the contrast case. */
  const NARROWED = 'writing-style-author';

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

  it.each(CONTEXTS)('rides the %s context\'s skill listing, declaring no contextTypes', (contextType) => {
    // 0.2.36: the fan-out reaches the prompt as a LISTING ROW, not as a delivered
    // package. The attachment is unchanged; only what it costs is.
    const resolver = new SkillResolver(skillRegistryWith(registry, tmp), tmp);
    expect(resolver.resolveForContext(contextType).listing.map((s) => s.slug)).toContain(SKILL);
  });

  /**
   * 0.2.66's two worked examples, side by side and both real. Omitting the field
   * and declaring `['chat']` are DIFFERENT STATEMENTS by two envelopes about their
   * own contributions, which is the whole claim of the release: the package decides
   * its reach, and the host holds no map of where to pin anything.
   */
  it.each(CONTEXTS)('sits beside a narrowed skill in %s, which is listed only in chat', (contextType) => {
    const listing = new SkillResolver(skillRegistryWith(registry, tmp), tmp)
      .resolveForContext(contextType)
      .listing.map((s) => s.slug);

    expect(listing).toContain(SKILL);
    expect(listing.includes(NARROWED)).toBe(contextType === 'chat');
  });

  /**
   * The filter narrows DISCOVERY, not ACCESS — asserted here on the real envelope
   * rather than a fixture, because this is the guarantee that stops the listing from
   * quietly becoming a permission boundary.
   */
  it('keeps the narrowed skill fully readable in a context that does not list it', () => {
    const skills = skillRegistryWith(registry, tmp);
    expect(new SkillResolver(skills, tmp).resolveForContext('brief').listing.map((s) => s.slug)).not.toContain(
      NARROWED,
    );
    expect(skills.has(NARROWED)).toBe(true);
    expect(skills.resolve(NARROWED).content.length).toBeGreaterThan(0);
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
 * 0.2.70 — the envelope that changed CLASS, from capability to coupling.
 *
 * From 0.2.57 this was the one plugin in the repo carrying no entity type. It
 * travelled as a single package for a reason no other envelope used: its
 * contributions were one authorial capability, writable and distributable by
 * someone outside this repo ("could a stranger want to write this and give it to
 * others?" — a writing style passes, an `endpoint`/`dto` pair does not).
 *
 * It now travels together for the ORDINARY reason instead, the one that binds
 * `ui-view` to `design-system`: the contributions declare each other. `SKILL.md`
 * mandates that a module-to-module relation is recorded as a `module-dependency`
 * entity, by slug and unconditionally — a sentence it can only afford because
 * the type rides in the same manifest and leaves on the same `unregisterPlugin`.
 * Split them and the type could be detached, leaving a style that mandates
 * writing into a type that is not there.
 *
 * So the last assertion below is no longer "one unregister takes two slots" but
 * "one unregister takes THREE", and that is the claim the class change is made
 * of.
 *
 * Driven through the real loader against the real `plugins/` tree for the same
 * reason as everything above it: a fixture would prove the machinery, and the
 * wiring is what changed.
 */
describe('the coupling-class envelope — a style that mandates its own type', () => {
  const PKG = 'c4s-plugin-layered-vertical-slices';
  const STYLE = 'layered-vertical-slices';
  const TYPE = 'module-dependency';
  const SUBAGENT = 'layered-spec-explore';
  const REVIEWER = 'spec-review';

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

  it('[ac:ac-manifest-koperty-c4s-plugin-layered-v] loads and contributes exactly module-dependency', () => {
    const record = registry.listPluginRecords().find((r) => r.name === PKG);
    expect(record, `${PKG} did not load`).toBeDefined();
    expect(record!.contributedTypes).toEqual([TYPE]);

    // And no OTHER envelope claims it — the type has one carrier, which is what
    // makes "the type is active" and "the package is active" the same question
    // for the consistency rules that gate on it.
    for (const other of registry.listPluginRecords().filter((p) => p.name !== PKG)) {
      expect(other.contributedTypes).not.toContain(TYPE);
    }
  });

  /**
   * HIDDEN is a backend non-statement: the type declares no route and no sidebar
   * tab on the client, and nothing on the manifest says "hidden" at all. What the
   * backend half must show is that it is a fully ordinary registered type
   * regardless — the host generates its whole write path.
   */
  it('is an ordinary active type, with no backend slot of its own', () => {
    const module = registry.consolidate(null).getEntity(TYPE);
    expect(module, `${TYPE} is not active`).toBeDefined();
    expect(module!.pathPrefix).toBe('/module-dependencies');
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
   * 0.2.57 emptied the in-package root of styles; 0.2.66 deleted the root and the
   * `'bundled'` source class with it. So this is no longer "the class is legal but
   * unpopulated" — there are two sources a style can have, and every style served
   * here has one of them.
   */
  it('is served as source "plugin", the bundled class having been retired', () => {
    const selectable = skillRegistryWith(registry, tmp).listSelectable();
    expect(selectable.find((s) => s.slug === STYLE)?.source).toBe('plugin');
    expect(selectable.map((s) => s.source).every((src) => src === 'user' || src === 'plugin')).toBe(true);
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
   * THE COUPLING ASSERTION. All three slots come down on one call, and the type
   * is the one that makes this a correctness property rather than tidiness:
   * `SKILL.md` mandates writing a `module-dependency` unconditionally, so a
   * teardown that took the style and left the type — or took the type and left
   * the style — would leave the project in a state the specification forbids.
   *
   * The subagents are coupled for the older reason and it still holds: a
   * `promptBody` REPLACES the parent's prompt, so without the style neither knows
   * what a module or a layer is.
   */
  it('[ac:ac-jedno-registry-unregisterplugin-c4s-p] one unregister takes the TYPE, the style AND both subagents', () => {
    const subagentNames = () =>
      registry.listPluginRecords().flatMap((r) => r.subagents).map((s) => s.name);

    expect(registry.listAvailable().map((m) => m.type)).toContain(TYPE);
    expect(registry.listSkills().map((s) => s.slug)).toContain(STYLE);
    expect(subagentNames()).toContain(SUBAGENT);
    expect(subagentNames()).toContain(REVIEWER);

    registry.unregisterPlugin(PKG);

    expect(registry.listAvailable().map((m) => m.type)).not.toContain(TYPE);
    expect(registry.listSkills().map((s) => s.slug)).not.toContain(STYLE);
    expect(subagentNames()).not.toContain(SUBAGENT);
    expect(subagentNames()).not.toContain(REVIEWER);
    expect(registry.listPluginRecords().map((r) => r.name)).not.toContain(PKG);

    // Teardown is per envelope, not global — the neighbours are untouched.
    expect(registry.listAvailable().map((m) => m.type)).toContain('endpoint');
  });
});

/**
 * 0.2.66 — the SINGLE-SLOT envelope, and what the host stopped shipping.
 *
 * `writing-style-author` was the last inhabitant of the in-package skills root, so
 * moving it into `c4s-plugin-writing-style-author` is what let that root be deleted
 * outright. Everything below is driven through the real loader against the real
 * `plugins/` tree, because the claim is about the wiring rather than the prose.
 */
describe('the single-slot envelope — c4s-plugin-writing-style-author', () => {
  const PKG = 'c4s-plugin-writing-style-author';
  const SKILL = 'writing-style-author';
  const CONTEXTS = ['chat', 'brief', 'patch', 'ask'] as const;

  function skillRegistryWith(registry: PluginRegistryImpl, cwd: string): SkillRegistry {
    const skills = SkillRegistry.load(findSkillsRoots(cwd));
    for (const skill of registry.listSkills()) skills.addPluginSkill(skill);
    return skills;
  }

  let registry: PluginRegistryImpl;
  let tmp: string;

  beforeAll(async () => {
    registry = await loadedRegistry();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-single-slot-envelope-'));
    fs.mkdirSync(path.join(tmp, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude4spec', 'config.json'), JSON.stringify({ writingStyle: null }));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loads with no trust gate and registers no entity type', () => {
    const record = registry.listPluginRecords().find((r) => r.name === PKG);
    expect(record, `${PKG} did not load`).toBeDefined();
    expect(record!.contributedTypes).toEqual([]);
  });

  it('contributes exactly one contextual skill, narrowed to chat', () => {
    const contributed = registry.listSkills().filter((s) => s.slug === SKILL);
    expect(contributed).toHaveLength(1);
    expect(contributed[0].scope).toBe('contextual');
    expect(contributed[0].contextTypes).toEqual(['chat']);
    expect(contributed[0].content.length).toBeGreaterThan(0);
  });

  /**
   * The scaffold is not a style, so it must never appear in the selector — the
   * settings dropdown offering "Writing Style Author" would invite a project to be
   * written IN the tool that writes styles.
   */
  it('is never selectable as a writing style', () => {
    const skills = skillRegistryWith(registry, tmp);
    expect(skills.listSelectable().map((x) => x.slug)).not.toContain(SKILL);
    expect(skills.isSelectable(SKILL)).toBe(false);
  });

  /**
   * The admission rule of the FS roots, end to end. A `writing-style-author`
   * directory dropped into `<cwd>/.claude/skills` is ignored, so an envelope's
   * contextual contribution cannot be swapped out the way a writing style can.
   */
  it('cannot be overridden by a contextual directory dropped into .claude/skills', () => {
    const dir = path.join(tmp, '.claude', 'skills', SKILL);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\ntitle: ${SKILL}\ndescription: an impostor\nversion: 1\nlanguage: en\nscope: contextual\n---\nIMPOSTOR BODY\n`,
    );
    try {
      const resolved = skillRegistryWith(registry, tmp).resolve(SKILL);
      expect(resolved.metadata.source).toBe('plugin');
      expect(resolved.content).not.toContain('IMPOSTOR BODY');
    } finally {
      fs.rmSync(path.join(tmp, '.claude'), { recursive: true, force: true });
    }
  });

  /**
   * Item 13 of the brief, end to end. The record is what `listSkills()` reads, and
   * the per-project `SkillRegistry` is rebuilt from it — which is why unregistering
   * the envelope takes the skill out of every context and out of `load_skill_file`'s
   * reach, without any registry-side removal step of its own.
   */
  it('one unregister takes the skill out of every context and out of the registry', () => {
    const before = skillRegistryWith(registry, tmp);
    expect(new SkillResolver(before, tmp).resolveForContext('chat').listing.map((x) => x.slug)).toContain(SKILL);

    registry.unregisterPlugin(PKG);

    const after = skillRegistryWith(registry, tmp);
    const resolver = new SkillResolver(after, tmp);
    for (const ct of CONTEXTS) {
      expect(resolver.resolveForContext(ct).listing.map((x) => x.slug), ct).not.toContain(SKILL);
    }
    // `load_skill_file` reads `has()`/`resolve()`; an absent slug is its SKILL_NOT_FOUND.
    expect(after.has(SKILL)).toBe(false);
    expect(() => after.resolve(SKILL)).toThrow(/unknown slug/);
    // The envelope carried no style, so config validation has nothing to re-check.
    expect(resolver.resolveForContext('chat').writingStyle).toBeNull();
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
   * Registry precedence is `project user > global user > plugin`, and a
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
    // Since the reformat the rules travel with the workflows, not in the core;
    // `daily.md` carries the whole catalogue at its end.
    const daily = resolved.files['workflows/daily.md']?.content ?? '';
    const rule = daily.slice(daily.indexOf('## Authoring rules'));

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

/**
 * 0.2.80 — the SAME two axes for `c4s-plugin-ac`, whose pairing is the other
 * rule.
 *
 * `ui-view` + `design-system` travel together because of a fixed single-target
 * `ref`: the target must be registered before the referrer, so splitting them
 * would cut the declaration. `ac` + `ac-audit` travel together for a different
 * reason entirely — the unit of distribution is an envelope's WHOLE
 * contribution. The subagent reads acceptance criteria and nothing else, so in a
 * project with no active `ac` type it has no subject matter.
 *
 * The distinction is worth pinning because applying the ref rule here would be
 * wrong in a specific, expensive way: `ac.verifies[]` is polymorphic — `{type,
 * slug}[]` aimed at any active type — so "put the ref's target in the same
 * envelope" would mean putting every type in one envelope.
 */
describe('axis A — c4s-plugin-ac ships one type and one subagent, as one unit', () => {
  const AC_ENVELOPE = 'c4s-plugin-ac';
  let registry: PluginRegistryImpl;
  beforeAll(async () => {
    registry = await loadedRegistry();
  });

  it('the type arrives through the envelope loader, not the core bootstrap', () => {
    expect(registry.listAvailable().map((m) => m.type)).toContain('ac');
    const record = registry.listPluginRecords().find((p) => p.name === AC_ENVELOPE);
    expect(record, `${AC_ENVELOPE} is not registered`).toBeDefined();
    expect([...record!.contributedTypes].sort()).toEqual(['ac']);
  });

  it('the subagent is contributed by the SAME envelope', () => {
    const record = registry.listPluginRecords().find((p) => p.name === AC_ENVELOPE);
    expect(record?.subagents?.map((sa) => sa.name)).toEqual(['ac-audit']);
  });

  it('unregistering takes the type AND the subagent down together', () => {
    const types = () => registry.listAvailable().map((m) => m.type);
    // Read by PULL off the registry, exactly as `subagentsFor()` does when a
    // turn is built — no copy is kept anywhere, which is why unregistering needs
    // no teardown step of its own.
    const subagents = () =>
      registry
        .listPluginRecords()
        .flatMap((p) => p.subagents ?? [])
        .map((sa) => sa.name);

    expect(types()).toContain('ac');
    expect(subagents()).toContain('ac-audit');

    registry.unregisterPlugin(AC_ENVELOPE);

    // Both, in one call — which is what "the unit of distribution is the whole
    // contribution" means in practice. A subagent left behind would be offered
    // in every turn with no entities to read.
    expect(types()).not.toContain('ac');
    expect(subagents()).not.toContain('ac-audit');

    // Other envelopes untouched: teardown is per envelope, not global.
    expect(types()).toContain('endpoint');
    expect(() => registry.unregisterPlugin(AC_ENVELOPE)).not.toThrow();
  });
});
