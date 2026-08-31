import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { HOST_API_VERSION } from '../../../src/shared/plugin-host/manifest.js';
import { manifest } from '../src/manifest.js';
import { layeredVerticalSlicesStyle } from '../src/skills/layered-vertical-slices.js';
import { layeredSpecExplore } from '../src/subagents/layered-spec-explore.js';

/**
 * The envelope's own shape, asserted against the REAL host registry rather than a
 * stub: what is new here is not the machinery but the claim that a manifest with
 * no entity type is a first-class one, and only the real `validateAndLower` can
 * settle that.
 */
describe('c4s-plugin-layered-vertical-slices — manifest', () => {
  it('[ac:ac-manifest-koperty-c4s-plugin-layered-v] registers with an empty contributes.entities[]', () => {
    const registry = new PluginRegistryImpl();
    expect(manifest.contributes.entities).toEqual([]);
    expect(() => registry.registerPlugin(manifest)).not.toThrow();

    const record = registry.listPluginRecords().find((r) => r.name === manifest.name);
    expect(record).toBeDefined();
    expect(record!.contributedTypes).toEqual([]);
    // Registered, and yet the type pool is untouched — the whole point of the class.
    expect(registry.listAvailable()).toEqual([]);
  });

  it('carries both contributions and nothing else', () => {
    expect(Object.keys(manifest.contributes).sort()).toEqual([
      'entities',
      'subagents',
      'writingStyles',
    ]);
    expect(manifest.contributes.writingStyles).toEqual([layeredVerticalSlicesStyle]);
    expect(manifest.contributes.subagents).toEqual([layeredSpecExplore]);
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
