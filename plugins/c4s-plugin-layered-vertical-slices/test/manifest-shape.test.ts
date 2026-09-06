import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { HOST_API_VERSION } from '../../../src/shared/plugin-host/manifest.js';
import { moduleDependencyEntity } from '../src/entity/module-dependency/index.js';
import { MODULE_DEPENDENCY_TYPE } from '../src/entity/module-dependency/identity.js';
import { manifest } from '../src/manifest.js';
import { layeredVerticalSlicesStyle } from '../src/skills/layered-vertical-slices.js';
import { layeredSpecExplore } from '../src/subagents/layered-spec-explore.js';
import { layeredSpecReview } from '../src/subagents/layered-spec-review.js';

/**
 * The envelope's own shape, asserted against the REAL host registry rather than a
 * stub. 0.2.70 inverts what this file is here to settle: the claim used to be
 * that a manifest with NO entity type is a first-class one, and it is now that
 * this particular manifest carries one — so only the real `validateAndLower` can
 * say whether the contribution is well-formed.
 */
describe('c4s-plugin-layered-vertical-slices — manifest', () => {
  it('[ac:ac-manifest-koperty-c4s-plugin-layered-v] contributes module-dependency, and the host accepts it', () => {
    const registry = new PluginRegistryImpl();
    expect(manifest.contributes.entities).toEqual([moduleDependencyEntity]);
    expect(() => registry.registerPlugin(manifest)).not.toThrow();

    const record = registry.listPluginRecords().find((r) => r.name === manifest.name);
    expect(record).toBeDefined();
    expect(record!.contributedTypes).toEqual([MODULE_DEPENDENCY_TYPE]);
    // The type reaches the pool through the manifest fan-out, not through the
    // core's `registerAllPlugins` — this package is not wired into that at all.
    expect(registry.listAvailable().map((m) => m.type)).toEqual([MODULE_DEPENDENCY_TYPE]);
  });

  it('carries all three POPULATED contributions and nothing else', () => {
    expect(Object.keys(manifest.contributes).sort()).toEqual([
      'entities',
      'subagents',
      'writingStyles',
    ]);
    expect(manifest.contributes.entities).toEqual([moduleDependencyEntity]);
    expect(manifest.contributes.writingStyles).toEqual([layeredVerticalSlicesStyle]);
    // TWO subagents, not one: the style ships an explorer AND a reviewer, and the
    // pair is the capability — a style whose saved changes nobody re-reads is a
    // style only at the moment of writing.
    expect(manifest.contributes.subagents).toEqual([layeredSpecExplore, layeredSpecReview]);
  });

  /**
   * The gate `continue`s BEFORE `registerPlugin`, so a stale range does not fail
   * loudly — the style is simply not there, and `config.writingStyle` then has no
   * carrier. For a built-in envelope the range agrees by construction; this test
   * is what keeps "by construction" true after a host bump.
   */
  it('targets the current Host API, so the floor invariant cannot silently lapse', () => {
    expect(manifest.hostApiVersion).toBe('^2.0.0');
    expect(HOST_API_VERSION.startsWith('2.')).toBe(true);
  });

  /** Purely declarative: no resource of its own, so no teardown hook of its own. */
  it('declares no onUnregister', () => {
    expect(manifest.onUnregister).toBeUndefined();
  });
});
