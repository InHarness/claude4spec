import { describe, expect, it } from 'vitest';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as pluginRuntimeUi from './plugin-runtime-ui.js';
import { PLUGIN_RUNTIME_UI_EXPORT_NAMES } from '../../shared/plugin-host/frontend-manifest.js';
import type { GroupedEntityListProps } from '../host-ui-kit/list/GroupedEntityList.js';

describe('@c4s/plugin-runtime/ui export parity', () => {
  it('the shim export-name list matches the module value exports (no drift)', () => {
    // Type-only re-exports are erased at runtime, so Object.keys = value exports.
    const actual = new Set(Object.keys(pluginRuntimeUi));
    const declared = new Set<string>(PLUGIN_RUNTIME_UI_EXPORT_NAMES);
    expect(actual).toEqual(declared);
  });

  it('[ac:ac-groupedentitylist-jest-importowalny-z] GroupedEntityList is a working export of @c4s/plugin-runtime/ui', () => {
    // The module the `/ui` specifier resolves to (published onto
    // `window.__c4s_shared['@c4s/plugin-runtime/ui']`) carries the component…
    expect(PLUGIN_RUNTIME_UI_EXPORT_NAMES).toContain('GroupedEntityList');
    const { GroupedEntityList } = pluginRuntimeUi;
    expect(typeof GroupedEntityList).toBe('function');
    // …as the catalog entry, not a stand-in.
    expect(pluginRuntimeUi.UI_KIT_CATALOG.find((c) => c.name === 'GroupedEntityList')).toMatchObject({
      group: 'list',
      stability: 'experimental',
      binding: 'presentational',
    });

    // And what is imported renders: groups laid out under their headings.
    const List = GroupedEntityList as unknown as FunctionComponent<GroupedEntityListProps<string>>;
    const html = renderToStaticMarkup(
      createElement(List, {
        groups: [{ key: 'srv', label: 'Server A', items: ['tool-1', 'tool-2'] }],
        renderRow: (item: string) => createElement('div', { key: item }, item),
      }),
    );
    expect(html).toContain('Server A');
    expect(html).toContain('tool-1');
    expect(html).toContain('tool-2');
  });
});
