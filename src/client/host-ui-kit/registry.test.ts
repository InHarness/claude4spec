import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_KIT_CATALOG, UI_KIT_STABLE_COMPONENTS as BROWSER_STABLE } from './registry.js';
import { UI_KIT_STABLE_COMPONENTS } from '../../shared/plugin-host/ui-kit-surface.js';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import { PLUGIN_RUNTIME_UI_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';
import { pluginRuntimeLegOf } from '../../shared/plugin-host/runtime-legs.js';
// The backend half of `@c4s/plugin-runtime/ui` (what a plugin backend links against).
import * as uiBackendLeg from '../../server/plugin-runtime/ui.js';
// The browser half of `@c4s/plugin-runtime/ui` (the catalog's re-export surface).
import * as uiBrowserSurface from './index.js';

describe('Host UI Kit catalog registry (M34/L12)', () => {
  it('catalogs all 32 components across the eight groups', () => {
    expect(UI_KIT_CATALOG).toHaveLength(32);
    const byGroup = (g: string) => UI_KIT_CATALOG.filter((c) => c.group === g).map((c) => c.name);
    expect(byGroup('core')).toEqual(['EntityListHeader', 'DetailPanelShell', 'FieldRow', 'FieldGrid']);
    expect(byGroup('list')).toEqual([
      'EntityListLayout',
      'Pagination',
      'EmptyState',
      'TagFilterBar',
      'EntityListRow',
      'GroupedEntityList',
    ]);
    expect(byGroup('actions')).toEqual(['ActionButton', 'ActionBar', 'Badge', 'LoadingState']);
    expect(byGroup('form')).toEqual(['FormField', 'InlineEditField']);
    expect(byGroup('overlay')).toEqual(['Dialog', 'FormShell']);
    expect(byGroup('detail')).toEqual([
      'SegmentedControlTabs',
      'VersionHistory',
      'DiffView',
      'EntityDetailToolbar',
      'RichTextField',
      'TagPicker',
      'ReferencesList',
      'DocumentBody',
      'DocEditor',
      'EntityVersionHistoryView',
    ]);
    expect(byGroup('feedback')).toEqual(['Popover', 'ToastViewport']);
    expect(byGroup('pickers')).toEqual(['EnumBadgePicker', 'GroupedRelationPicker']);
  });

  it('marks exactly the four Core components stable and the rest experimental', () => {
    const stable = UI_KIT_CATALOG.filter((c) => c.stability === 'stable').map((c) => c.name);
    const experimental = UI_KIT_CATALOG.filter((c) => c.stability === 'experimental');
    expect(stable).toEqual(['EntityListHeader', 'DetailPanelShell', 'FieldRow', 'FieldGrid']);
    expect(experimental).toHaveLength(28);
    // Every Core component is stable; no other group is.
    for (const c of UI_KIT_CATALOG) {
      expect(c.stability).toBe(c.group === 'core' ? 'stable' : 'experimental');
    }
  });

  it('[ac:ac-kazdy-wpis-katalogu-host-ui-kit-deklaruj] every catalog entry declares a binding', () => {
    for (const c of UI_KIT_CATALOG) {
      expect(['presentational', 'connected']).toContain(c.binding);
    }
  });

  it('marks exactly DocEditor and EntityVersionHistoryView as connected', () => {
    const connected = UI_KIT_CATALOG.filter((c) => c.binding === 'connected').map((c) => c.name);
    expect(connected).toEqual(['DocEditor', 'EntityVersionHistoryView']);
  });

  it('[ac:ac-komponent-o-binding-connected-jawni] every connected entry names the L11 surface it consumes, and no presentational one does', () => {
    for (const c of UI_KIT_CATALOG) {
      if (c.binding === 'connected') {
        expect(c.l11Surfaces?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(c.l11Surfaces).toBeUndefined();
      }
    }
  });

  it('keeps the whole stable core presentational', () => {
    for (const c of UI_KIT_CATALOG.filter((c) => c.stability === 'stable')) {
      expect(c.binding).toBe('presentational');
    }
  });

  it('[ac:ac-entityversionhistoryview-ma-stability] keeps the new connected block experimental, outside the versioned surface', () => {
    const block = UI_KIT_CATALOG.find((c) => c.name === 'EntityVersionHistoryView');
    expect(block?.stability).toBe('experimental');
    // Adding it to the catalog must NOT pull it into `hostApiVersion`.
    expect(BROWSER_STABLE).not.toContain('EntityVersionHistoryView');
    expect(HOST_API_VERSION).toBe('2.1.0');
  });

  it('[section:m34l12sc] the browser /ui leg derives UI_KIT_STABLE_COMPONENTS from the registry, equal to the backend /ui leg constant of the same name', () => {
    // Derived from the registry: exactly the `stable` entries, in catalog order.
    expect(BROWSER_STABLE).toEqual(
      UI_KIT_CATALOG.filter((c) => c.stability === 'stable').map((c) => c.name),
    );
    // The browser `/ui` surface exports that same derived list, under the one
    // name both legs share (2.1.25, m33rt001); the old browser name is gone.
    expect(uiBrowserSurface.UI_KIT_STABLE_COMPONENTS).toBe(BROWSER_STABLE);
    expect(uiBrowserSurface).not.toHaveProperty('STABLE_UI_KIT_COMPONENTS');
    // Equal to the constant the backend `/ui` leg carries — same names, no
    // duplicates, nothing on one side missing from the other.
    const backend = [...uiBackendLeg.UI_KIT_STABLE_COMPONENTS];
    expect(new Set(backend).size).toBe(backend.length);
    expect(new Set(BROWSER_STABLE).size).toBe(BROWSER_STABLE.length);
    expect([...BROWSER_STABLE].sort()).toEqual(backend.sort());
    // The backend leg serves the shared versioned list itself, not a copy.
    expect(uiBackendLeg.UI_KIT_STABLE_COMPONENTS).toBe(UI_KIT_STABLE_COMPONENTS);
  });
  it('[section:m34l12sc] /ui exports UI_KIT_CATALOG as data plus useToast, useHostTokens, HOST_TOKEN_NAMES and readHostTokens beside it, none of them a catalog entry', () => {
    expect(uiBrowserSurface.UI_KIT_CATALOG).toBe(UI_KIT_CATALOG);
    for (const e of UI_KIT_CATALOG) {
      expect(Object.keys(e).filter((k) => k !== 'l11Surfaces').sort()).toEqual(
        ['binding', 'group', 'name', 'stability'].sort(),
      );
    }
    const names = UI_KIT_CATALOG.map((c) => c.name);
    for (const beside of ['useToast', 'useHostTokens', 'HOST_TOKEN_NAMES', 'readHostTokens']) {
      expect(uiBrowserSurface).toHaveProperty(beside);
      expect(names).not.toContain(beside);
    }
  });

  it('[ac:ac-doceditor-m34-experimental-host-wired] the connected DocEditor entry names the L11 singletons editorBridge and queryClient as its consumed surface', () => {
    const docEditor = UI_KIT_CATALOG.find((c) => c.name === 'DocEditor');
    expect(docEditor?.binding).toBe('connected');
    expect(docEditor?.stability).toBe('experimental');
    expect(docEditor?.l11Surfaces).toEqual(['editorBridge', 'queryClient']);
    // Both names are singletons the published `@c4s/plugin-runtime` surface
    // (L11) actually exports, not labels of their own.
    const published = readFileSync(
      fileURLToPath(new URL('../../plugin-types/plugin-runtime.ts', import.meta.url)),
      'utf8',
    );
    for (const singleton of docEditor?.l11Surfaces ?? []) {
      expect(published).toMatch(new RegExp(`export declare const ${singleton}: `));
    }
  });

  it('[section:m33rt001] the data services feed the L12 catalog (TagFilterBar among it, re-exported on /ui), DiffView takes its hunks from a caller, and the connected DocEditor binds the editorBridge and queryClient singletons', () => {
    const byName = (n: string) => UI_KIT_CATALOG.find((c) => c.name === n);
    // L12 consumers of the data services: presentational, props-in — TagFilterBar
    // is one of them and travels on the browser leg of `@c4s/plugin-runtime/ui`.
    for (const name of ['VersionHistory', 'TagPicker', 'TagFilterBar', 'ReferencesList']) {
      expect(byName(name)?.binding, name).toBe('presentational');
      expect(byName(name)?.l11Surfaces, name).toBeUndefined();
      expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES, name).toContain(name);
      expect(uiBrowserSurface, name).toHaveProperty(name);
    }
    expect(byName('TagFilterBar')?.group).toBe('list');
    // DiffView's hunks do not come from a data service: the component is
    // presentational and consumes no L11 surface; `lineDiffHunks` (a pure util,
    // browser leg) is one of the sources a caller hands it.
    expect(byName('DiffView')?.binding).toBe('presentational');
    expect(byName('DiffView')?.l11Surfaces).toBeUndefined();
    expect(pluginRuntimeLegOf('lineDiffHunks')).toBe('browser');
    // The connected components power themselves: EntityVersionHistoryView calls
    // the hooks, DocEditor binds the editorBridge and queryClient singletons —
    // every name a browser-leg value of `@c4s/plugin-runtime`.
    const connected = UI_KIT_CATALOG.filter((c) => c.binding === 'connected').map((c) => c.name);
    expect(connected).toEqual(expect.arrayContaining(['DocEditor', 'EntityVersionHistoryView']));
    expect(byName('DocEditor')?.l11Surfaces).toEqual(['editorBridge', 'queryClient']);
    for (const c of UI_KIT_CATALOG.filter((e) => e.binding === 'connected')) {
      expect(c.l11Surfaces?.length ?? 0, c.name).toBeGreaterThan(0);
      for (const surface of c.l11Surfaces ?? []) expect(pluginRuntimeLegOf(surface), `${c.name} → ${surface}`).toBe('browser');
    }
  });
});
