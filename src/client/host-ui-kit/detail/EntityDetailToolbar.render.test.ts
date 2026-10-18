// @vitest-environment happy-dom
/**
 * M34/L12 — `EntityDetailToolbar` (group `detail`, `experimental`) against its
 * `ui-kit-component` record `entity-detail-toolbar` (2.1.28): title, back and
 * a delete `ActionButton`; delete calls `onDelete` with no dialog in between,
 * and the toolbar mutates nothing itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EntityDetailToolbar, type EntityDetailToolbarProps } from './EntityDetailToolbar.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props` — no references prop, no history prop. */
interface RecordEntityDetailToolbarProps {
  title: string;
  onBack?: () => void;
  onDelete?: () => void;
  busy?: boolean;
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

const mount = (props: EntityDetailToolbarProps) => act(() => root.render(createElement(EntityDetailToolbar, props)));
const deleteButton = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Delete');
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('EntityDetailToolbar ↔ record `entity-detail-toolbar` (M34/L12, 2.1.28)', () => {
  it('[entity:entity-detail-toolbar] takes exactly the record props (host and published /ui alike) — no brokenRefs', () => {
    const a: Same<EntityDetailToolbarProps, RecordEntityDetailToolbarProps> = true;
    const b: Same<Published.EntityDetailToolbarProps, RecordEntityDetailToolbarProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:entity-detail-toolbar] renders the title, a back button calling onBack, and the delete ActionButton disabled while busy', () => {
    const onBack = vi.fn();
    mount({ title: 'User DTO', onBack, onDelete: () => {}, busy: true });
    expect(host.textContent).toContain('User DTO');
    click(host.querySelector('[aria-label="Back"]')!);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(deleteButton()!.disabled).toBe(true);
  });

  it('[entity:entity-detail-toolbar] without onBack / onDelete renders the title only', () => {
    mount({ title: 'Only a title' });
    expect(host.textContent).toBe('Only a title');
    expect(host.querySelector('button')).toBeNull();
  });

  it('[ac:ac-entitydetailtoolbar-przy-operacji-dele] a click on delete opens no confirmation window of its own', () => {
    mount({ title: 'User DTO', onDelete: () => {} });
    click(deleteButton()!);
    // No dialog anywhere in the document (the kit Dialog portals to body).
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/cannot be undone|Delete this/i);
    expect(Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Delete').length).toBe(1);
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Cancel')).toBe(false);
  });

  it('[ac:ac-komponent-entitydetailtoolbar-m34-e] a click on delete calls onDelete once, and the toolbar itself deletes nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onDelete = vi.fn();
    mount({ title: 'User DTO', onDelete });
    click(deleteButton()!);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith();
    // No request of its own: the delete is the author's callback.
    expect(fetchSpy).not.toHaveBeenCalled();
    // The toolbar is still there, unchanged — it holds no deleted state.
    expect(host.textContent).toContain('User DTO');
  });
});

describe('EntityDetailToolbar — conditional controls and busy (M34/L12, 2.1.33)', () => {
  it('[entity:entity-detail-toolbar] the back arrow renders only with onBack, the delete button only with onDelete', () => {
    mount({ title: 'T', onDelete: () => {} });
    expect(host.querySelector('[aria-label="Back"]')).toBeNull();
    expect(deleteButton()).toBeDefined();

    mount({ title: 'T', onBack: () => {} });
    expect(host.querySelector('[aria-label="Back"]')).not.toBeNull();
    expect(deleteButton()).toBeUndefined();
  });

  it('[entity:entity-detail-toolbar] busy disables only the Delete button — the back arrow stays usable', () => {
    const onBack = vi.fn();
    const onDelete = vi.fn();
    mount({ title: 'T', onBack, onDelete, busy: true });
    const back = host.querySelector<HTMLButtonElement>('[aria-label="Back"]')!;
    expect(back.disabled).toBe(false);
    expect(deleteButton()!.disabled).toBe(true);
    click(back);
    click(deleteButton()!);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
