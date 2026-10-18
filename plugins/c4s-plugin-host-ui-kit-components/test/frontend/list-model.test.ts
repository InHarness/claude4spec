/**
 * The type's own list order (c4s-plugin-host-ui-kit-components `ctpko3bp`).
 */

import { describe, expect, it } from 'vitest';
import { groupRecords, rowSubtitle } from '../../src/entity/ui-kit-component/frontend/list-model.js';
import type { UiKitComponent } from '../../src/types.js';

const rec = (name: string, group: UiKitComponent['group'], extra: Partial<UiKitComponent> = {}): UiKitComponent => ({
  slug: name.toLowerCase(),
  title: name,
  name,
  group,
  stability: 'experimental',
  binding: 'presentational',
  props: [],
  types: [],
  dataSources: [],
  composes: [],
  tags: [],
  ...extra,
});

describe('ui-kit-component list', () => {
  it('[section:ctpko3bp] groups follow the group enum order, empty groups are hidden, records sort by name inside a group', () => {
    const groups = groupRecords([
      rec('Toast', 'feedback'),
      rec('Badge', 'actions'),
      rec('ActionButton', 'actions'),
      rec('EntityListHeader', 'core'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['core', 'actions', 'feedback']);
    expect(groups[1]!.items.map((r) => r.name)).toEqual(['ActionButton', 'Badge']);
  });

  it('[section:ctpko3bp] search covers name, props[].name and types[].name', () => {
    const records = [
      rec('Badge', 'actions', { props: [{ name: 'variant', type: 'string', required: false }] }),
      rec('TagFilterBar', 'list', { types: [{ name: 'Tag', definition: '{}' }] }),
      rec('Dialog', 'overlay'),
    ];
    const names = (q: string) => groupRecords(records, q).flatMap((g) => g.items.map((r) => r.name));
    expect(names('dialog')).toEqual(['Dialog']);
    expect(names('variant')).toEqual(['Badge']);
    expect(names('tag')).toEqual(['TagFilterBar']);
  });

  it('[section:ctpko3bp] the list row subtitle reads "<n> props · <binding>"', () => {
    expect(rowSubtitle({ props: [{ name: 'a', type: 'x', required: true }, { name: 'b', type: 'y', required: false }], binding: 'connected' })).toBe(
      '2 props · connected',
    );
  });
});
