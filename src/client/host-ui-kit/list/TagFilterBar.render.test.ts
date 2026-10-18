// @vitest-environment happy-dom
/**
 * M34/L12 — `TagFilterBar` (group `list`, `experimental`) against its
 * `ui-kit-component` record `tag-filter-bar` (2.1.28): each tag a `Badge`
 * chip, selection state and the `and|or` mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TagFilterBar, type TagBarProps } from './TagFilterBar.js';
import { EntityListHeader } from '../core/EntityListHeader.js';
import { EntityListLayout } from './EntityListLayout.js';
import * as kit from '../index.js';
import type { Tag } from '../../../shared/plugin-host/ui-kit-surface.js';
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

interface RecordTag {
  slug: string;
  name: string;
  color?: string | null;
  description?: string | null;
}
interface RecordTagFilterBarProps {
  tags: RecordTag[];
  tagFilter: string[];
  onTagToggle: (slug: string) => void;
  tagMode: 'and' | 'or';
  onToggleMode: () => void;
  onClear: () => void;
}

const TAGS: Tag[] = [
  { slug: 'm34', name: 'M34', color: '#336699' },
  { slug: 'l12', name: 'L12' },
];

function bar(over: Partial<TagBarProps> = {}) {
  const props: TagBarProps = {
    tags: TAGS,
    tagFilter: [],
    onTagToggle: () => {},
    tagMode: 'and',
    onToggleMode: () => {},
    onClear: () => {},
    ...over,
  };
  mount(createElement(TagFilterBar, props));
}
const chips = () => Array.from(host.querySelectorAll<HTMLElement>('span.rounded-full[role="button"]'));
const btn = (text: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.startsWith(text));

describe('TagFilterBar ↔ record `tag-filter-bar` (M34/L12, 2.1.28)', () => {
  it('[entity:tag-filter-bar] takes exactly the record props; Tag is the one structural tag type (host, published /ui)', () => {
    const a: Same<TagBarProps, RecordTagFilterBarProps> = true;
    const b: Same<Published.TagBarProps, RecordTagFilterBarProps> = true;
    const c: Same<Tag, RecordTag> = true;
    const d: Same<Published.Tag, RecordTag> = true;
    expect([a, b, c, d]).toEqual([true, true, true, true]);
  });

  it('[entity:tag-filter-bar] renders every tag as a Badge chip and toggles a tag by its slug', () => {
    const onTagToggle = vi.fn();
    bar({ onTagToggle, tagFilter: ['m34'] });
    expect(chips().map((c) => c.textContent)).toEqual(['M34', 'L12']);
    // The selected one is the filled (active) chip.
    expect(chips()[0]!.style.background).not.toBe('var(--c-panel)');
    expect(chips()[0]!.style.background).not.toBe('');
    expect(chips()[1]!.style.background).toBe('var(--c-panel)');
    act(() => chips()[1]!.click());
    expect(onTagToggle).toHaveBeenCalledWith('l12');
  });

  it('[entity:tag-filter-bar] the and|or mode toggle shows from two selected tags, clear from one', () => {
    const onToggleMode = vi.fn();
    const onClear = vi.fn();
    bar({ tagFilter: ['m34'], onToggleMode, onClear });
    expect(btn('match')).toBeUndefined();
    act(() => btn('clear')!.click());
    expect(onClear).toHaveBeenCalledTimes(1);
    bar({ tagFilter: ['m34', 'l12'], tagMode: 'or', onToggleMode, onClear });
    expect(btn('match')!.textContent).toBe('match or');
    act(() => btn('match')!.click());
    expect(onToggleMode).toHaveBeenCalledTimes(1);
  });

  it('[entity:tag-filter-bar] with an empty `tags` it renders nothing', () => {
    bar({ tags: [] });
    expect(host.innerHTML).toBe('');
  });

  it('[entity:tag-filter-bar] stands under EntityListHeader, full width, as its sibling in EntityListLayout `header` — not in the header `filters` slot (2.1.33)', () => {
    const tagBar: TagBarProps = {
      tags: TAGS,
      tagFilter: [],
      onTagToggle: () => {},
      tagMode: 'and',
      onToggleMode: () => {},
      onClear: () => {},
    };
    mount(
      createElement(EntityListLayout, {
        header: createElement(
          'div',
          { 'data-testid': 'header-slot' },
          createElement(EntityListHeader, { title: 'Endpoints', search: '', onSearchChange: () => {} }),
          createElement(TagFilterBar, tagBar),
        ),
        children: 'rows',
      }),
    );
    const slot = host.querySelector<HTMLElement>('[data-testid="header-slot"]')!;
    const [headerBar, tagStrip] = Array.from(slot.children) as HTMLElement[];
    // Header row first, the tag strip right under it — siblings in the layout header.
    expect(headerBar!.querySelector('h2')?.textContent).toBe('Endpoints');
    expect(tagStrip!.textContent).toContain('Filter by tag:');
    expect(headerBar!.contains(tagStrip!)).toBe(false);
    expect(headerBar!.textContent).not.toContain('Filter by tag:');
    // Full width: a block-level strip with no width cap of its own, wrapping its chips.
    expect(tagStrip!.tagName).toBe('DIV');
    expect(tagStrip!.style.width).toBe('');
    expect(tagStrip!.style.maxWidth).toBe('');
    expect(tagStrip!.className).not.toMatch(/inline-flex|\bw-\[|max-w-/);
    expect(tagStrip!.className).toContain('flex-wrap');
    // Outside the scroll region, like the header.
    expect(tagStrip!.closest('.overflow-auto')).toBeNull();
  });

  it('[entity:tag-filter-bar] its props type is exported as TagBarProps (kit index and published /ui), against the <Component>Props convention', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const index = readFileSync(resolve(here, '../index.ts'), 'utf8');
    const published = readFileSync(resolve(here, '../../../plugin-types/ui.ts'), 'utf8');
    expect(index).toMatch(/export \{ TagFilterBar, type TagBarProps \} from '\.\/list\/TagFilterBar\.js';/);
    expect(published).toMatch(/export interface TagBarProps \{/);
    expect(published).toMatch(/export declare const TagFilterBar: ComponentType<TagBarProps>;/);
    expect(index).not.toMatch(/\bTagFilterBarProps\b/);
    expect(published).not.toMatch(/\bTagFilterBarProps\b/);
    expect(kit.TagFilterBar).toBe(TagFilterBar);
  });
});
