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
  /** A real bundled writing style, so the `<project_skill/>` slot is genuinely occupied. */
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
