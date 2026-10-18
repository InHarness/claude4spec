// @vitest-environment happy-dom
/**
 * M34/L12 — `GroupedRelationPicker` (group `pickers`, `experimental`) against
 * its `ui-kit-component` record `grouped-relation-picker` (2.1.28): relations
 * grouped per type, props-in; each group opens its OWN `Popover` of candidates
 * from "+ link", the candidate list capped at 280 px; link/unlink are callbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GroupedRelationPicker, type GroupedRelationPickerProps } from './GroupedRelationPicker.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

interface RecordGroupedRelationPickerProps {
  groups: { key: string; label: string; items: { id: string; label: string; badge?: ReactNode }[] }[];
  selected: Record<string, string[]>;
  onAdd: (groupKey: string, id: string) => void;
  onRemove: (groupKey: string, id: string) => void;
  onSearch?: (q: string, groupKey?: string) => void;
  onGroupOpen?: (groupKey: string) => void;
  maxHeight?: number;
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

const mount = (props: GroupedRelationPickerProps) => act(() => root.render(createElement(GroupedRelationPicker, props)));
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
const linkButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === '+ link');
const popovers = () => Array.from(host.querySelectorAll<HTMLElement>('[role="dialog"]'));

const GROUPS: GroupedRelationPickerProps['groups'] = [
  { key: 'request', label: 'Request', items: [{ id: 'user-in', label: 'UserIn' }, { id: 'page-in', label: 'PageIn' }] },
  { key: 'response', label: 'Response', items: [{ id: 'user-out', label: 'UserOut' }, { id: 'err', label: 'Error' }] },
];

function props(extra: Partial<GroupedRelationPickerProps> = {}): GroupedRelationPickerProps {
  return { groups: GROUPS, selected: { request: ['user-in'], response: [] }, onAdd: vi.fn(), onRemove: vi.fn(), ...extra };
}

describe('GroupedRelationPicker ↔ record `grouped-relation-picker` (M34/L12, 2.1.28)', () => {
  it('[entity:grouped-relation-picker] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<GroupedRelationPickerProps, RecordGroupedRelationPickerProps> = true;
    const b: Same<Published.GroupedRelationPickerProps, RecordGroupedRelationPickerProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[ac:ac-groupedrelationpicker-grupa-pickers-m34] renders the relations grouped per type from props, and link / unlink are only the author callbacks', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const p = props();
    mount(p);
    expect(host.textContent).toContain('Request');
    expect(host.textContent).toContain('Response');
    expect(host.textContent).toContain('UserIn');

    click(host.querySelector('[aria-label="unlink UserIn"]')!);
    expect(p.onRemove).toHaveBeenCalledWith('request', 'user-in');
    // It does not mutate: the chip stays until the author changes `selected`.
    expect(host.textContent).toContain('UserIn');

    click(linkButtons()[1]!);
    click(Array.from(popovers()[0]!.querySelectorAll('button')).find((b) => b.textContent === 'Error')!);
    expect(p.onAdd).toHaveBeenCalledWith('response', 'err');
    expect(host.textContent).not.toContain('UserOut');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-groupedrelationpicker-z-zadanym-maxheigh] "+ link" opens a separate candidate popover for each group', () => {
    const onGroupOpen = vi.fn();
    mount(props({ onGroupOpen }));
    expect(popovers()).toEqual([]);

    click(linkButtons()[0]!);
    expect(popovers().length).toBe(1);
    expect(onGroupOpen).toHaveBeenLastCalledWith('request');
    // The request group's candidates only (the linked UserIn is not offered).
    expect(popovers()[0]!.textContent).toContain('PageIn');
    expect(popovers()[0]!.textContent).not.toContain('UserIn');
    expect(popovers()[0]!.textContent).not.toContain('UserOut');

    click(linkButtons()[1]!);
    expect(onGroupOpen).toHaveBeenLastCalledWith('response');
    const responsePopover = popovers().find((p) => p.textContent?.includes('UserOut'))!;
    expect(responsePopover).toBeDefined();
    expect(responsePopover.textContent).not.toContain('PageIn');
  });

  it('[ac:ac-lista-kandydatow-w-popoverze-grupy-gr] the candidate list in a group popover is at most 280 px high', () => {
    mount(props());
    click(linkButtons()[0]!);
    const panel = popovers()[0]!;
    expect(panel.style.maxHeight).toBe('280px');
    // The list scrolls inside the cap instead of growing the panel.
    expect(panel.querySelector('.overflow-auto')).not.toBeNull();
  });
});
