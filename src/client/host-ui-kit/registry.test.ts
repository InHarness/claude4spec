import { describe, expect, it } from 'vitest';
import { UI_KIT_CATALOG, STABLE_UI_KIT_COMPONENTS } from './registry.js';
import { UI_KIT_STABLE_COMPONENTS } from '../../shared/plugin-host/ui-kit-surface.js';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';

describe('Host UI Kit catalog registry (M34/L12)', () => {
  it('catalogs all 31 components across the eight groups', () => {
    expect(UI_KIT_CATALOG).toHaveLength(31);
    const byGroup = (g: string) => UI_KIT_CATALOG.filter((c) => c.group === g).map((c) => c.name);
    expect(byGroup('core')).toEqual(['EntityListHeader', 'DetailPanelShell', 'FieldRow', 'FieldGrid']);
    expect(byGroup('list')).toEqual([
      'EntityListLayout',
      'Pagination',
      'EmptyState',
      'TagFilterBar',
      'EntityListRow',
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
    expect(experimental).toHaveLength(27);
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
    expect(HOST_API_VERSION).toBe('3.0.0');
  });

  it('derived stable set matches the React-free versioned surface (no drift)', () => {
    // The version surface (host-api.ts) reads the shared list; the components
    // carry their own field-level `stability`. These two must agree.
    expect(new Set(STABLE_UI_KIT_COMPONENTS)).toEqual(new Set(UI_KIT_STABLE_COMPONENTS));
  });
});
