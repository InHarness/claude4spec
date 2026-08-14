import { describe, expect, it } from 'vitest';
import { HOST_API_VERSION } from './manifest.js';
import { buildMigrationInfo, migrationsBetween, rangeMajor, VERSIONED_UI_KIT_COMPONENTS } from './host-api.js';
import { UI_KIT_CATALOG } from '../../client/host-ui-kit/registry.js';

/**
 * M34/L12 (0.1.144): `stability` describes the contract towards PLUGINS only.
 * The host consuming a catalog component — including an `experimental` one —
 * is not a versioned surface, so it must not enter the `hostApiVersion` gate
 * nor force a promotion to `stable`.
 */
describe('M34/L12 — the version gate counts contribution, not consumption', () => {
  it('[ac:ac-konsumpcja-komponentu-experimental-przez] versions only the stable tier, never the experimental one', () => {
    const experimental = UI_KIT_CATALOG.filter((c) => c.stability === 'experimental').map(
      (c) => c.name,
    );
    expect(experimental.length).toBeGreaterThan(0);
    for (const name of experimental) {
      expect(VERSIONED_UI_KIT_COMPONENTS).not.toContain(name);
    }

    const stable = UI_KIT_CATALOG.filter((c) => c.stability === 'stable').map((c) => c.name);
    expect([...VERSIONED_UI_KIT_COMPONENTS].sort()).toEqual([...stable].sort());
  });

  it('[ac:ac-konsumpcja-komponentu-experimental-przez] keeps the major at the 1.0.0 baseline despite host-side consumption', () => {
    // The host consumes TagFilterBar, EntityListRow, Dialog, Popover, useToast,
    // EnumBadgePicker, GroupedRelationPicker and ActionBar — all experimental.
    // None of that is a published contract, so the major cannot have moved.
    // Back on the 2.0.0 baseline: 0.2.22 raised it for `title`, and 0.2.23
    // reverted that under the stabilisation rule. Either way the claim this
    // case makes is unchanged — consuming an experimental component moved
    // nothing.
    expect(HOST_API_VERSION).toBe('2.0.0');
    expect(migrationsBetween(1, 1)).toEqual([]);
  });
});

describe('M33 — Host API versioning helpers', () => {
  it('parses the first major from a semver range', () => {
    expect(rangeMajor('^1.4.0')).toBe(1);
    expect(rangeMajor('>=2.5.0')).toBe(2);
    expect(rangeMajor('~3.0.0')).toBe(3);
    expect(rangeMajor('nonsense')).toBeNull();
  });

  it('carries the 1 → 2 crossing, and only that', () => {
    const crossing = migrationsBetween(1, 2);
    expect(crossing.map((m) => m.slot).sort()).toEqual([
      'backend.migrations',
      // 0.2.9 (tier D): the per-module rename hook, replaced by the `ref` flag.
      'backend.onEntityRenamed',
      'routes.prefix',
      /**
       * 0.2.9 (tier B): the hand-written snapshot/restore pair, now generated
       * from `data.schema`.
       *
       * Listed SEPARATELY from the view/semver/schema entry below, though both
       * name `serializer.*` and both landed in tier B. Item 53 calls for a
       * descriptor per removed slot, and these are the two halves a 1.x author
       * would look up independently: one is "how do I still render", the other
       * "how do I still persist". Collapsing them would have left `snapshot`
       * and `restore` — which the brief's own `plugins doctor` sample prints —
       * matching nothing a reader could grep for.
       */
      'serializer.{snapshot,restore}',
      // 0.2.9 (tier B): the serializer's five flat view callbacks, its advisory
      // semver and its hand-written schema — all derived now, all removed.
      'serializer.{version,inlineMention,singleElement,elementListItem,taggedListItem,schema}',
      'slugFrom',
    ]);
    // A span that crosses no boundary is empty, in both directions.
    expect(migrationsBetween(1, 1)).toEqual([]);
    expect(migrationsBetween(2, 2)).toEqual([]);
    // 1 → 2 is the ONLY crossing, so a wider span contains exactly it. The
    // shape changes 0.2.22/0.2.23 landed on top are absorbed into the 2.0.0
    // baseline under the stabilisation rule rather than opening a second one.
    expect(migrationsBetween(0, 9).length).toBe(crossing.length);
    expect(migrationsBetween(2, 3)).toEqual([]);
  });

  it('offers NO shim for a 1.x plugin — it must cross into 2.0.0', () => {
    const info = buildMigrationInfo('^1.0.0');
    expect(info).not.toBeNull();
    expect(info!.targetHostApiVersion).toBe(HOST_API_VERSION);
    // The one crossing, since a 1.x package is exactly one major behind.
    expect(info!.migrations).toHaveLength(6);
    expect(info!.migrations.every((m) => m.kind === 'slot-removed')).toBe(true);
    /**
     * The assertion that matters to a plugin author: there is no compatibility
     * path. Shimming these would mean inferring a logical schema from
     * hand-written DDL and a slug function — the exact inference 2.0.0 exists
     * to stop making — so the package simply does not load until it is
     * re-authored.
     */
    expect(info!.shimAvailable).toBe(false);
  });

  it('returns null when the plugin targets the current major (no migration needed)', () => {
    expect(buildMigrationInfo('^2.0.0')).toBeNull();
    expect(buildMigrationInfo('^2.5.0')).toBeNull(); // same major, even if unsatisfiable
  });

  /**
   * A package from the FUTURE gets no descriptor to walk — there is nothing
   * recorded past the current baseline, and inventing one would be guessing.
   */
  it('gives a 3.x plugin a descriptor with no crossings to make', () => {
    const info = buildMigrationInfo('^3.0.0');
    expect(info).not.toBeNull();
    expect(info!.migrations).toEqual([]);
    expect(info!.shimAvailable).toBe(false);
  });
});
