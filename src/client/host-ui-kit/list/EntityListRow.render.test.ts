// @vitest-environment happy-dom
/**
 * M34/L12 — `EntityListRow` (group `list`, `experimental`) against its
 * `ui-kit-component` record `entity-list-row` (2.1.28): tag chips drawn by
 * `TagChip` (2.1.39; `Badge` before) in its `small` variant, slugs resolved through `tagLookup`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tag as TagIcon } from 'lucide-react';
import { EntityListRow, type EntityListRowProps } from './EntityListRow.js';
import { TagChip } from '../actions/TagChip.js';
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

interface RecordEntityListRowProps {
  leading?: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  tags?: string[];
  tagLookup: Map<string, Published.Tag>;
  trailing?: ReactNode;
  align?: 'center' | 'start';
  style?: CSSProperties;
  children: ReactNode;
}

const lookup = new Map<string, Published.Tag>([['m34', { slug: 'm34', name: 'M34', color: '#336699' }]]);

describe('EntityListRow ↔ record `entity-list-row` (M34/L12, 2.1.28)', () => {
  it('[entity:entity-list-row] takes exactly the record props (host and published /ui alike); icon is a LucideIcon', () => {
    const a: Same<EntityListRowProps, RecordEntityListRowProps> = true;
    const b: Same<Published.EntityListRowProps, RecordEntityListRowProps> = true;
    const c: Same<NonNullable<EntityListRowProps['icon']>, NonNullable<Published.EntityListHeaderProps['icon']>> = true;
    expect([a, b, c]).toEqual([true, true, true]);
  });

  it('[entity:entity-list-row] renders tag chips through TagChip (small), resolving slugs via tagLookup', () => {
    mount(createElement(EntityListRow, { tags: ['m34', 'unknown'], tagLookup: lookup, children: 'GET /api/users' }));
    const strip = host.querySelector('.flex-wrap')!;
    const chips = Array.from(strip.children) as HTMLElement[];
    expect(chips.map((c) => c.textContent)).toEqual(['M34', 'unknown']);

    // Exactly TagChip's small chip for the same tag.
    const probe = document.createElement('div');
    const probeRoot = createRoot(probe);
    act(() => probeRoot.render(createElement(TagChip, { label: 'M34', color: '#336699', small: true })));
    expect(chips[0]!.outerHTML).toBe(probe.innerHTML);
    act(() => probeRoot.unmount());
  });

  it('[entity:entity-list-row] no tag strip without tags', () => {
    mount(createElement(EntityListRow, { tags: [], tagLookup: lookup, children: 'row' }));
    expect(host.querySelector('.flex-wrap')).toBeNull();
  });

  it('[entity:entity-list-row] with onClick the row is a button; without it a plain container', () => {
    const onClick = vi.fn();
    mount(createElement(EntityListRow, { tagLookup: lookup, onClick, children: 'row' }));
    const row = host.firstElementChild as HTMLElement;
    expect(row.tagName).toBe('BUTTON');
    act(() => row.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    mount(createElement(EntityListRow, { tagLookup: lookup, children: 'row' }));
    expect(host.firstElementChild!.tagName).toBe('DIV');
  });

  it('[entity:entity-list-row] icon, leading, trailing, align and style slots', () => {
    mount(
      createElement(
        EntityListRow,
        {
          tagLookup: lookup,
          icon: TagIcon,
          leading: createElement('i', { 'data-testid': 'lead' }),
          trailing: createElement('b', { 'data-testid': 'trail' }),
          align: 'start',
          style: { marginBottom: 0 },
          children: 'row',
        },
      ),
    );
    const row = host.firstElementChild as HTMLElement;
    expect(row.firstElementChild!.tagName.toLowerCase()).toBe('svg');
    expect(row.querySelector('[data-testid="lead"]')).not.toBeNull();
    expect(row.lastElementChild!.getAttribute('data-testid')).toBe('trail');
    expect(row.className).toContain('items-start');
    expect(row.style.marginBottom).toBe('0px');
  });

  it('[entity:entity-list-row] a tag missing from tagLookup shows its slug in the default colour (2.1.33)', () => {
    mount(createElement(EntityListRow, { tags: ['ghost'], tagLookup: lookup, children: 'row' }));
    const chip = host.querySelector('.flex-wrap')!.firstElementChild as HTMLElement;
    expect(chip.textContent).toBe('ghost');
    // Exactly TagChip's small chip with no colour, i.e. TagChip's default (var(--c-muted)) dot — no broken chip for tags.
    const probe = document.createElement('div');
    const probeRoot = createRoot(probe);
    act(() => probeRoot.render(createElement(TagChip, { label: 'ghost', small: true })));
    expect(chip.outerHTML).toBe(probe.innerHTML);
    act(() => probeRoot.unmount());
    expect(chip.outerHTML).toContain('var(--c-muted)');
  });

  it('[entity:entity-list-row] anatomy: the icon is 16 px in var(--c-accent), and the leading slot stands after it (2.1.33)', () => {
    mount(
      createElement(EntityListRow, {
        tagLookup: lookup,
        icon: TagIcon,
        leading: createElement('i', { 'data-testid': 'lead' }),
        children: 'row',
      }),
    );
    const row = host.firstElementChild as HTMLElement;
    const svg = row.firstElementChild as SVGElement;
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('style')).toMatch(/color:\s*var\(--c-accent\)/);
    expect((svg.nextElementSibling as HTMLElement).dataset.testid).toBe('lead');
  });

  it('[entity:entity-list-row] `onClick` makes the whole row a <button>; without it the row is a <div> container whose own slot controls are not nested in a button (2.1.33)', () => {
    mount(
      createElement(EntityListRow, {
        tagLookup: lookup,
        trailing: createElement('button', { 'data-testid': 'own' }, 'edit'),
        children: 'row',
      }),
    );
    const row = host.firstElementChild as HTMLElement;
    expect(row.tagName).toBe('DIV');
    const own = row.querySelector('[data-testid="own"]')!;
    expect(own.parentElement!.closest('button')).toBeNull();
    const onClick = vi.fn();
    mount(createElement(EntityListRow, { tagLookup: lookup, onClick, children: 'row' }));
    const btnRow = host.firstElementChild as HTMLElement;
    expect(btnRow.tagName).toBe('BUTTON');
    act(() => (btnRow.querySelector('.flex-1') as HTMLElement).click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
