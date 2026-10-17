// @vitest-environment happy-dom
/**
 * M34/L12 — `TagPicker` (group `detail`, `experimental`) against its
 * `ui-kit-component` record `tag-picker` (2.1.28): multi-select tags from
 * props, chips through the catalog `Badge`; `collapsed` shows the selected
 * chips + "+N" and reveals the full list and the inline create in the
 * published `Popover` (scrolling list, create pinned in the footer); `onCreate`
 * for an existing slug is a no-op.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagPicker, idempotentCreate, type TagPickerProps } from './TagPicker.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

interface RecordTagPickerProps {
  allTags: { slug: string; name: string; color?: string | null }[];
  selected: string[];
  onToggle: (slug: string) => void;
  onCreate?: (name: string) => void;
  variant?: 'flat' | 'collapsed';
}

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

const mount = (props: TagPickerProps) => act(() => root.render(createElement(TagPicker, props)));
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
/** Badge chips: the clickable `role="button"` spans. */
const chips = (scope: ParentNode = host) =>
  Array.from(scope.querySelectorAll<HTMLElement>('span[role="button"]')).map((c) => c.textContent);
const popover = () => host.querySelector<HTMLElement>('[role="dialog"]');

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const enter = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });

const TAGS = [
  { slug: 'auth', name: 'Auth', color: 'var(--c-blue)' },
  { slug: 'billing', name: 'Billing', color: null },
  { slug: 'zazolc-gesla', name: 'Zażółć gęślą' },
];

describe('TagPicker ↔ record `tag-picker` (M34/L12, 2.1.28)', () => {
  it('[entity:tag-picker] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<TagPickerProps, RecordTagPickerProps> = true;
    const b: Same<Published.TagPickerProps, RecordTagPickerProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[ac:ac-komponent-tagpicker-m34-experimenta] renders a multi-select of allTags (flat by default), toggling through onToggle, each chip the existing Badge', () => {
    const onToggle = vi.fn();
    mount({ allTags: TAGS, selected: ['auth'], onToggle });
    expect(chips()).toEqual(['Auth', 'Billing', 'Zażółć gęślą']);
    // Selected = the active Badge (filled with its colour).
    const auth = Array.from(host.querySelectorAll<HTMLElement>('span[role="button"]'))[0]!;
    expect(auth.getAttribute('style')).toContain('background: var(--c-blue)');
    click(Array.from(host.querySelectorAll('span[role="button"]'))[1]!);
    expect(onToggle).toHaveBeenCalledWith('billing');
    // No create input without onCreate.
    expect(host.querySelector('input')).toBeNull();
    // The chip is the catalog Badge, not an atom of its own.
    const src = readFileSync(fileURLToPath(new URL('./TagPicker.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/import \{ Badge \} from '\.\.\/actions\/Badge\.js'/);
    expect(src).toMatch(/<Badge\b/);
  });

  it('[ac:ac-komponent-tagpicker-m34-experimenta] with onCreate, the inline create hands a new name to onCreate', () => {
    const onCreate = vi.fn();
    mount({ allTags: TAGS, selected: [], onToggle: () => {}, onCreate });
    const input = host.querySelector('input')!;
    type(input, 'Payments');
    enter(input);
    expect(onCreate).toHaveBeenCalledWith('Payments');
  });

  it('[ac:ac-tagpicker-oncreate-dla-nazwy-dajacej-j] onCreate for a name giving an existing slug is a no-op (by the backend slug rules); an existing unselected tag is selected instead, a selected one left as is', () => {
    const onCreate = vi.fn();
    const onToggle = vi.fn();
    // `billing` is selected; `auth` and `zazolc-gesla` exist but are not.
    mount({ allTags: TAGS, selected: ['billing'], onToggle, onCreate });
    const input = host.querySelector('input')!;
    for (const name of ['Auth', 'auth', '  AUTH ', 'zażółć  gęślą', 'Billing', ' billing ']) {
      type(input, name);
      enter(input);
    }
    expect(onCreate).not.toHaveBeenCalled();
    // Existing but not selected → attached through onToggle (no create); already selected → nothing.
    expect(onToggle.mock.calls).toEqual([['auth'], ['auth'], ['auth'], ['zazolc-gesla']]);
    // The same guard as a function: an existing slug never reaches onCreate, a new one passes.
    const spy = vi.fn();
    const toggle = vi.fn();
    const create = idempotentCreate(TAGS, ['billing'], toggle, spy)!;
    create('Billing');
    create('Auth');
    create('Billing v2');
    expect(spy.mock.calls).toEqual([['Billing v2']]);
    expect(toggle.mock.calls).toEqual([['auth']]);
    expect(idempotentCreate(TAGS, [], toggle, undefined)).toBeUndefined();
  });

  it('[ac:ac-tagpicker-w-wariancie-collapsed-renderuj] collapsed renders chips for the selected tags only + a "+N" reveal control, and reveals the full list and the inline create in the published Popover', () => {
    const onCreate = vi.fn();
    mount({ allTags: TAGS, selected: ['billing'], onToggle: () => {}, onCreate, variant: 'collapsed' });
    expect(chips()).toEqual(['Billing']);
    expect(host.querySelector('input')).toBeNull();
    expect(popover()).toBeNull();

    const reveal = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '+2')!;
    expect(reveal).toBeDefined();
    click(reveal);
    const panel = popover()!;
    expect(panel).not.toBeNull();
    expect(chips(panel)).toEqual(['Auth', 'Billing', 'Zażółć gęślą']);
    expect(panel.querySelector('input[placeholder="New tag…"]')).not.toBeNull();
    // The Popover is rendered only in this variant.
    const src = readFileSync(fileURLToPath(new URL('./TagPicker.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/import \{ Popover \} from '\.\.\/overlay-feedback\/Popover\.js'/);
    act(() => root.render(createElement(TagPicker, { allTags: TAGS, selected: [], onToggle: () => {}, onCreate })));
    expect(popover()).toBeNull();
  });

  it('[ac:ac-w-wariancie-collapsed-tagpicker-odslania] the revealed list scrolls within the Popover maxHeight (240 px) and the create input sits in the pinned footer, outside the scroll', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ slug: `t-${i}`, name: `Tag ${i}` }));
    mount({ allTags: many, selected: [], onToggle: () => {}, onCreate: () => {}, variant: 'collapsed' });
    click(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '+80')!);
    const panel = popover()!;
    expect(panel.style.maxHeight).toBe('240px');
    const body = panel.children[0] as HTMLElement;
    const footer = panel.children[1] as HTMLElement;
    // The list is in the scrolling body…
    expect(body.className).toContain('overflow-auto');
    expect(chips(body).length).toBe(80);
    // …and the create input in the footer, a sibling outside the scrolling body.
    expect(body.querySelector('input')).toBeNull();
    expect(footer.querySelector('input[placeholder="New tag…"]')).not.toBeNull();
    expect(footer.className).not.toContain('overflow-auto');
  });
});
