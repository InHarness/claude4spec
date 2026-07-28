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
    expect(HOST_API_VERSION).toBe('1.0.0');
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

  it('has an empty changelog at the 1.0.0 baseline (no major crossed yet)', () => {
    expect(migrationsBetween(1, 2)).toHaveLength(0);
    expect(migrationsBetween(0, 9)).toHaveLength(0);
  });

  it('builds migration info for a different-major plugin, with empty descriptors and no shim', () => {
    const info = buildMigrationInfo('^2.0.0');
    expect(info).not.toBeNull();
    expect(info!.targetHostApiVersion).toBe(HOST_API_VERSION);
    expect(info!.migrations).toHaveLength(0);
    expect(info!.shimAvailable).toBe(false);
  });

  it('returns null when the plugin targets the current major (no migration needed)', () => {
    expect(buildMigrationInfo('^1.0.0')).toBeNull();
    expect(buildMigrationInfo('^1.5.0')).toBeNull(); // same major, even if unsatisfiable
  });
});
