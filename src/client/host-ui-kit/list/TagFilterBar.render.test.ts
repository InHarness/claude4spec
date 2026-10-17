// @vitest-environment happy-dom
/**
 * M34/L12 — `TagFilterBar` (group `list`, `experimental`) against its
 * `ui-kit-component` record `tag-filter-bar` (2.1.28): each tag a `Badge`
 * chip, selection state and the `and|or` mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagFilterBar, type TagBarProps } from './TagFilterBar.js';
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

  it('[entity:tag-filter-bar] draws nothing without tags', () => {
    bar({ tags: [] });
    expect(host.innerHTML).toBe('');
  });
});
