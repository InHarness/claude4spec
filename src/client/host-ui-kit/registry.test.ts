import { describe, expect, it } from 'vitest';
import { UI_KIT_CATALOG, STABLE_UI_KIT_COMPONENTS } from './registry.js';
import { UI_KIT_STABLE_COMPONENTS } from '../../shared/plugin-host/ui-kit-surface.js';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
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
    expect(STABLE_UI_KIT_COMPONENTS).not.toContain('EntityVersionHistoryView');
    expect(HOST_API_VERSION).toBe('2.1.0');
  });

  it('[section:m34l12sc] STABLE_UI_KIT_COMPONENTS is derived from the registry and equals the backend /ui leg constant UI_KIT_STABLE_COMPONENTS', () => {
    // Derived from the registry: exactly the `stable` entries, in catalog order.
    expect(STABLE_UI_KIT_COMPONENTS).toEqual(
      UI_KIT_CATALOG.filter((c) => c.stability === 'stable').map((c) => c.name),
    );
    // The browser `/ui` surface exports that same derived list.
    expect(uiBrowserSurface.STABLE_UI_KIT_COMPONENTS).toBe(STABLE_UI_KIT_COMPONENTS);
    // Equal to the constant the backend `/ui` leg carries — same names, no
    // duplicates, nothing on one side missing from the other.
    const backend = [...uiBackendLeg.UI_KIT_STABLE_COMPONENTS];
    expect(new Set(backend).size).toBe(backend.length);
    expect(new Set(STABLE_UI_KIT_COMPONENTS).size).toBe(STABLE_UI_KIT_COMPONENTS.length);
    expect([...STABLE_UI_KIT_COMPONENTS].sort()).toEqual(backend.sort());
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
    // DocEditor binds both live L11 singletons.
    expect(UI_KIT_CATALOG.find((c) => c.name === 'DocEditor')?.l11Surfaces).toEqual([
      'EditorBridge',
      'QueryClient',
    ]);
  });
});
