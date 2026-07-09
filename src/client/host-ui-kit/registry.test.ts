import { describe, expect, it } from 'vitest';
import { UI_KIT_CATALOG, STABLE_UI_KIT_COMPONENTS } from './registry.js';
import { UI_KIT_STABLE_COMPONENTS } from '../../shared/plugin-host/ui-kit-surface.js';

describe('Host UI Kit catalog registry (M34/L12)', () => {
  it('catalogs all 29 components across the eight groups', () => {
    expect(UI_KIT_CATALOG).toHaveLength(29);
    const byGroup = (g: string) => UI_KIT_CATALOG.filter((c) => c.group === g).map((c) => c.name);
    expect(byGroup('core')).toEqual(['EntityListHeader', 'DetailPanelShell', 'FieldRow', 'FieldGrid']);
    expect(byGroup('list')).toEqual([
      'EntityListLayout',
      'Pagination',
      'EmptyState',
      'TagFilterBar',
      'EntityListRow',
    ]);
    expect(byGroup('actions')).toEqual(['ActionButton', 'Badge', 'LoadingState']);
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
    ]);
    expect(byGroup('feedback')).toEqual(['Popover', 'ToastViewport']);
    expect(byGroup('pickers')).toEqual(['EnumBadgePicker', 'GroupedRelationPicker']);
  });

  it('marks exactly the four Core components stable and the rest experimental', () => {
    const stable = UI_KIT_CATALOG.filter((c) => c.stability === 'stable').map((c) => c.name);
    const experimental = UI_KIT_CATALOG.filter((c) => c.stability === 'experimental');
    expect(stable).toEqual(['EntityListHeader', 'DetailPanelShell', 'FieldRow', 'FieldGrid']);
    expect(experimental).toHaveLength(25);
    // Every Core component is stable; no other group is.
    for (const c of UI_KIT_CATALOG) {
      expect(c.stability).toBe(c.group === 'core' ? 'stable' : 'experimental');
    }
  });

  it('derived stable set matches the React-free versioned surface (no drift)', () => {
    // The version surface (host-api.ts) reads the shared list; the components
    // carry their own field-level `stability`. These two must agree.
    expect(new Set(STABLE_UI_KIT_COMPONENTS)).toEqual(new Set(UI_KIT_STABLE_COMPONENTS));
  });
});
