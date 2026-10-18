// @vitest-environment happy-dom
/**
 * M34/L12 — `GroupedEntityList` (group `list`, `experimental`) against its
 * `ui-kit-component` record `grouped-entity-list` (2.1.28): the catalog's one
 * generic, declared as a function, not as a `ComponentType`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  GroupedEntityList,
  type GroupedEntityListGroup,
  type GroupedEntityListProps,
} from './GroupedEntityList.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = (el: ReactNode) => act(() => root.render(el));

interface RecordGroup<T> {
  key: string;
  label: ReactNode;
  items: T[];
}
interface RecordGroupedEntityListProps<T> {
  groups: RecordGroup<T>[];
  renderRow: (item: T, index: number) => ReactNode;
  emptyState?: ReactNode;
  emptyGroupState?: ReactNode;
}
interface Item {
  id: string;
}

const row = (item: Item, i: number) => createElement('div', { key: item.id, 'data-row': `${item.id}@${i}` }, item.id);

describe('GroupedEntityList ↔ record `grouped-entity-list` (M34/L12, 2.1.28)', () => {
  it('[entity:grouped-entity-list] takes exactly the record props for any T; the published export is a generic function', () => {
    const a: Same<GroupedEntityListProps<Item>, RecordGroupedEntityListProps<Item>> = true;
    const b: Same<Published.GroupedEntityListProps<Item>, RecordGroupedEntityListProps<Item>> = true;
    const c: Same<GroupedEntityListGroup<Item>, RecordGroup<Item>> = true;
    const d: Same<Published.GroupedEntityListGroup<Item>, RecordGroup<Item>> = true;
    // Declared as `<T>(props) => ReactNode`, so `T` is inferred from `groups` and flows to `renderRow`.
    type Fn = typeof Published.GroupedEntityList;
    const e: Fn extends <T>(props: Published.GroupedEntityListProps<T>) => ReactNode ? true : false = true;
    expect([a, b, c, d, e]).toEqual([true, true, true, true, true]);
  });

  it('[entity:grouped-entity-list] lays out the given groups in order, each heading over its rows', () => {
    const groups: GroupedEntityListGroup<Item>[] = [
      { key: 'a', label: 'Server A', items: [{ id: 'x' }, { id: 'y' }] },
      { key: 'b', label: 'Server B', items: [{ id: 'z' }] },
    ];
    mount(createElement(GroupedEntityList<Item>, { groups, renderRow: row }));
    const sections = Array.from(host.querySelectorAll('section'));
    expect(sections.map((s) => s.querySelector('h2')!.textContent)).toEqual(['Server A', 'Server B']);
    expect(Array.from(sections[0]!.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'))).toEqual([
      'x@0',
      'y@1',
    ]);
  });

  it('[entity:grouped-entity-list] skips an empty group unless emptyGroupState is given; emptyState replaces an empty list', () => {
    const groups: GroupedEntityListGroup<Item>[] = [
      { key: 'a', label: 'A', items: [] },
      { key: 'b', label: 'B', items: [{ id: 'z' }] },
    ];
    mount(createElement(GroupedEntityList<Item>, { groups, renderRow: row }));
    expect(host.querySelectorAll('section')).toHaveLength(1);
    mount(createElement(GroupedEntityList<Item>, { groups, renderRow: row, emptyGroupState: 'No tools yet' }));
    expect(host.querySelectorAll('section')).toHaveLength(2);
    expect(host.querySelector('section')!.textContent).toContain('No tools yet');
    mount(createElement(GroupedEntityList<Item>, { groups: [], renderRow: row, emptyState: 'Nothing here' }));
    expect(host.textContent).toBe('Nothing here');
  });
});

describe('GroupedEntityList — empty states, key and no grouping of its own (M34/L12, 2.1.33)', () => {
  it('[entity:grouped-entity-list] with no visible group and no emptyState it draws nothing; emptyState renders when every group is empty', () => {
    const empty: GroupedEntityListGroup<Item>[] = [{ key: 'a', label: 'A', items: [] }];
    mount(createElement(GroupedEntityList<Item>, { groups: empty, renderRow: row }));
    expect(host.innerHTML).toBe('');
    mount(createElement(GroupedEntityList<Item>, { groups: [], renderRow: row }));
    expect(host.innerHTML).toBe('');
    mount(createElement(GroupedEntityList<Item>, { groups: empty, renderRow: row, emptyState: 'Nothing here' }));
    expect(host.textContent).toBe('Nothing here');
  });

  it('[entity:grouped-entity-list] emptyGroupState is the content of an empty group, under its heading', () => {
    const groups: GroupedEntityListGroup<Item>[] = [{ key: 'srv', label: 'Server', items: [] }];
    mount(createElement(GroupedEntityList<Item>, { groups, renderRow: row, emptyGroupState: 'No tools yet' }));
    const section = host.querySelector('section')!;
    expect(section.querySelector('h2')!.textContent).toBe('Server');
    expect(section.textContent).toBe('ServerNo tools yet');
    expect(section.querySelector('[data-row]')).toBeNull();
  });

  it('[entity:grouped-entity-list] a group key is only the React key — the heading shows the label, the key is never displayed', () => {
    const groups: GroupedEntityListGroup<Item>[] = [{ key: 'internal-key-42', label: 'Shown label', items: [{ id: 'x' }] }];
    mount(createElement(GroupedEntityList<Item>, { groups, renderRow: row }));
    expect(host.textContent).toContain('Shown label');
    expect(host.innerHTML).not.toContain('internal-key-42');
  });

  it('[entity:grouped-entity-list] does not group by itself and has no flat mode: the groups are the consumer\'s, rendered as given', () => {
    type Keys = keyof GroupedEntityListProps<Item>;
    const noGroupBy: 'groupBy' extends Keys ? false : true = true;
    const noFlat: 'flat' extends Keys ? false : true = true;
    expect([noGroupBy, noFlat]).toEqual([true, true]);
    // Items in the consumer's order and grouping — nothing re-sorted or re-grouped.
    const groups: GroupedEntityListGroup<Item>[] = [
      { key: 'b', label: 'B', items: [{ id: 'z' }, { id: 'a' }] },
      { key: 'a', label: 'A', items: [{ id: 'm' }] },
    ];
    mount(createElement(GroupedEntityList<Item>, { groups, renderRow: row }));
    expect(Array.from(host.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'))).toEqual(['z@0', 'a@1', 'm@0']);
  });
});
