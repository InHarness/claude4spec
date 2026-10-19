import { describe, expect, it } from 'vitest';
import { HOST_API_VERSION } from './manifest.js';
import {
  buildMigrationInfo,
  HOST_API_MINOR_RELEASES,
  HOST_API_RELEASES,
  HOST_API_UNVERSIONED_CHANGES,
  migrationsBetween,
  recordedUiKitStableComponents,
  rangeMajor,
  VERSIONED_UI_KIT_COMPONENTS,
} from './host-api.js';
import { UI_KIT_CATALOG } from '../../client/host-ui-kit/registry.js';
import { UI_KIT_STABLE_COMPONENTS } from './ui-kit-surface.js';

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
    expect(HOST_API_VERSION).toBe('2.1.0');
    expect(migrationsBetween(1, 1)).toEqual([]);
  });

  /**
   * 0.2.24 — no source file may NAME a Host API version other than the constant.
   *
   * 0.2.22 raised the baseline to 3.0.0 and 0.2.23 reverted it, but nine
   * comments and — worse — three registration ERROR MESSAGES kept saying
   * "required in Host API 3.0.0". A plugin author reading that would go looking
   * for a major this host rejects, over a slot it actually requires. The
   * constant is one line; the sentences quoting it were not checked by
   * anything, so they drifted the moment the number moved back.
   */
  it('is the only Host API version any source file names', async () => {
    const { execFileSync } = await import('node:child_process');
    const root = new URL('../../../', import.meta.url).pathname;
    let out = '';
    try {
      out = execFileSync(
        'grep',
        ['-rIn', '--include=*.ts', '--include=*.tsx', '-E', 'Host API [0-9]+\\.[0-9]+\\.[0-9]+', 'src', 'plugins'],
        { cwd: root, encoding: 'utf8' },
      );
    } catch {
      out = ''; // grep exits 1 when it matches nothing
    }
    const offenders = out
      .split('\n')
      .filter((line) => line.trim() !== '')
      // This file is the one place that may name a wrong version: the rule has
      // to quote what it is banning to explain itself.
      .filter((line) => !line.startsWith('src/shared/plugin-host/host-api.test.ts:'))
      .filter((line) => !/Host API 2\.0\.0/.test(line));
    expect(offenders).toEqual([]);
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

describe('2.1.0 — the Host API changelog records the minor bump', () => {
  it('the newest minor release is the running HOST_API_VERSION, and it removes registerExtensionReferenceType', () => {
    const latest = HOST_API_MINOR_RELEASES[HOST_API_MINOR_RELEASES.length - 1]!;
    expect(HOST_API_VERSION).toBe('2.1.0');
    expect(latest.version).toBe(HOST_API_VERSION);
    expect(latest.changes.map((c) => c.kind)).toEqual(['slot-added', 'slot-removed']);
    expect(latest.changes[1]!.slot).toContain('registerExtensionReferenceType');
  });
});

/**
 * 2.1.20 (M33 `m33load01`) — the specification's Host API changelog has its
 * counterpart in code: every versioned entry in the release registry, every
 * in-baseline entry in the unversioned-changes registry, and the composition of
 * the `stable` UI-kit list is recorded by them.
 */
describe('[section:m33load01] the Host API changelog and its two registries in code', () => {
  const sorted = (xs: Iterable<string>) => [...xs].sort();
  const compare = (a: string, b: string) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
    return 0;
  };

  it('[section:m33load01] the release registry holds each versioned changelog entry, oldest first, ending at HOST_API_VERSION', () => {
    expect(HOST_API_RELEASES.map((r) => `${r.version}:${r.kind}`)).toEqual(['2.0.0:major', '2.1.0:minor']);
    for (let i = 1; i < HOST_API_RELEASES.length; i++) {
      expect(compare(HOST_API_RELEASES[i - 1]!.version, HOST_API_RELEASES[i]!.version)).toBeLessThan(0);
    }
    expect(HOST_API_RELEASES[HOST_API_RELEASES.length - 1]!.version).toBe(HOST_API_VERSION);
    // The major carries the crossing's descriptors; every minor of the minor list is a release.
    const major = HOST_API_RELEASES.find((r) => r.version === '2.0.0')!;
    expect(major.migrations).toEqual(migrationsBetween(1, 2));
    expect(major.migrations!.length).toBeGreaterThan(0);
    for (const minor of HOST_API_MINOR_RELEASES) {
      expect(HOST_API_RELEASES.find((r) => r.version === minor.version)?.changes).toEqual(minor.changes);
    }
  });

  it('[section:m33load01] every in-baseline changelog entry has its unversioned-change record', () => {
    const slots = HOST_API_UNVERSIONED_CHANGES.map((c) => c.slot);
    const recorded = (re: RegExp) => slots.some((s) => re.test(s));
    // additive: the fifth envelope slot, the field flag, the named validators, the read core in MountContext
    expect(recorded(/^contributes\.skills$/)).toBe(true);
    expect(recorded(/contentBearing/)).toBe(true);
    expect(recorded(/ScalarNode\.kind/)).toBe(true);
    expect(recorded(/MountContext\.\{getEntities,listEntities,searchEntities,describeTypes,resolveIdentity,getFieldContent\}/)).toBe(true);
    // retirements absorbed into the baseline
    expect(recorded(/^injection/)).toBe(true);
    expect(recorded(/SerializationContribution\.diff/)).toBe(true);
    expect(recorded(/CollectionNode\.collection \(object form\)/)).toBe(true);
    expect(recorded(/PluginSkillContribution\.contextTypes/)).toBe(true);
    expect(recorded(/onUnregister/)).toBe(true);
    expect(recorded(/stateSlice/) && recorded(/emptyState/)).toBe(true);
    // 2.1.20 — the withdrawal of the type contribution's frontend slot is recorded
    // in the same retirement entry as the other two frontend fields.
    const retirement = HOST_API_UNVERSIONED_CHANGES.find((c) => /EntityContribution\.frontend/.test(c.slot));
    expect(retirement?.kind).toBe('slot-removed');
    expect(retirement?.slot).toMatch(/stateSlice/);
    expect(retirement?.slot).toMatch(/emptyState/);
    // additive facade/client-host names
    expect(recorded(/^mcpTool\(…, annotations\?\)$/)).toBe(true);
    expect(recorded(/onRegistryChanged/) && recorded(/registryVersion/)).toBe(true);
    // the shell's four window facades on the browser leg (M50 `tbeatf5z`)
    const facades = HOST_API_UNVERSIONED_CHANGES.find((c) =>
      ['openPopover', 'openModal', 'confirmDestructive', 'toast'].every((n) => c.slot.includes(n)),
    );
    expect(facades?.kind).toBe('slot-added');
    expect(facades?.slot).toMatch(/^@c4s\/plugin-runtime:/);
  });

  it('[section:m33load01] the 2.1.21 retirement of contributes.settings is an unversioned slot removal, with no bump and no migrations[] descriptor', () => {
    const retired = HOST_API_UNVERSIONED_CHANGES.find((c) => /^contributes\.settings\b/.test(c.slot));
    expect(retired?.release).toBe('2.1.21');
    expect(retired?.kind).toBe('slot-removed');
    for (const name of ['PluginSettingsModule', 'PluginSettingField', 'ProjectPluginHost.listSettings()']) {
      expect(retired?.slot).toContain(name);
    }
    // No bump: the version is still the 2.1.0 baseline and no release carries the retirement.
    expect(HOST_API_VERSION).toBe('2.1.0');
    expect(HOST_API_RELEASES.map((r) => r.version)).toEqual(['2.0.0', '2.1.0']);
    for (const release of HOST_API_RELEASES) {
      expect(JSON.stringify(release)).not.toMatch(/contributes\.settings|PluginSetting/);
    }
  });

  it('[section:m33load01] the 2.1.25 single name of the /ui stable list is recorded as unversioned changes — the new browser name added, the old one removed — with no bump and no stable-list delta', () => {
    const changes = HOST_API_UNVERSIONED_CHANGES.filter((c) => c.release === '2.1.25' && c.slot.startsWith('@c4s/plugin-runtime/ui:'));
    const added = changes.find((c) => c.slot.includes('UI_KIT_STABLE_COMPONENTS'));
    const removed = changes.find((c) => c.slot.includes('STABLE_UI_KIT_COMPONENTS') && !c.slot.includes('UI_KIT_STABLE_COMPONENTS'));
    expect(added?.kind).toBe('slot-added');
    expect(removed?.kind).toBe('slot-removed');
    // The composition of the list is unchanged: neither entry carries a promotion or demotion…
    expect(added?.uiKitStable).toBeUndefined();
    expect(removed?.uiKitStable).toBeUndefined();
    // …so no release records it, and the version stays the baseline.
    expect(HOST_API_VERSION).toBe('2.1.0');
    expect(HOST_API_RELEASES.map((r) => r.version)).toEqual(['2.0.0', '2.1.0']);
    for (const release of HOST_API_RELEASES) {
      expect(JSON.stringify(release)).not.toMatch(/STABLE_UI_KIT_COMPONENTS/);
    }
  });

  it('[section:m33load01] the 2.1.26 retirement of displayOrder is an unversioned removal from the type identity, with no bump and no migrations[] descriptor', () => {
    const retired = HOST_API_UNVERSIONED_CHANGES.filter((c) => /displayOrder/.test(c.slot));
    // Exactly one record, in this window's release, as a removal from the identity.
    expect(retired).toHaveLength(1);
    expect(retired[0]!.release).toBe('2.1.26');
    expect(retired[0]!.kind).toBe('slot-removed');
    expect(retired[0]!.slot).toContain('EntityModuleManifest');
    // The ordering that survives is the sidebar tab's, and only it.
    expect(retired[0]!.summary).toContain('sidebarTab.order');
    expect(retired[0]!.uiKitStable).toBeUndefined();
    // No bump: the version is still the 2.1.0 baseline, no release and no
    // major-crossing descriptor carries the retirement.
    expect(HOST_API_VERSION).toBe('2.1.0');
    expect(HOST_API_RELEASES.map((r) => r.version)).toEqual(['2.0.0', '2.1.0']);
    for (const release of HOST_API_RELEASES) {
      expect(JSON.stringify(release)).not.toMatch(/displayOrder/);
    }
    expect(JSON.stringify(migrationsBetween(0, Number.MAX_SAFE_INTEGER))).not.toMatch(/displayOrder/);
  });

  it('[section:m33load01] the 2.1.38 UI text sizes of the token bridge are an unversioned addition, with no bump and no stable-list delta', () => {
    const added = HOST_API_UNVERSIONED_CHANGES.filter((c) => c.release === '2.1.38');
    expect(added).toHaveLength(1);
    expect(added[0]!.kind).toBe('slot-added');
    for (const name of ['HOST_TOKEN_NAMES', 'HostTokenName', '--text-sm', '--text-xs', '--text-2xs']) {
      expect(added[0]!.slot).toContain(name);
    }
    expect(added[0]!.uiKitStable).toBeUndefined();
    expect(HOST_API_VERSION).toBe('2.1.0');
    expect(HOST_API_RELEASES.map((r) => r.version)).toEqual(['2.0.0', '2.1.0']);
  });

  it('[section:m33load01] the composition of UI_KIT_STABLE_COMPONENTS is exactly what the registries record', () => {
    expect(sorted(recordedUiKitStableComponents())).toEqual(sorted(UI_KIT_STABLE_COMPONENTS));
  });
});

