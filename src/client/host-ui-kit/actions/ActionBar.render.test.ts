// @vitest-environment happy-dom
/**
 * M34/L12 — `ActionBar` (group `actions`, `experimental`) against its
 * `ui-kit-component` record `action-bar` (2.1.28): props/types as the record
 * states, every action drawn by `ActionButton`, status slot on the left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ActionBar, type ActionBarAction, type ActionBarProps } from './ActionBar.js';
import { ActionButton, type ActionButtonVariant } from './ActionButton.js';
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

interface RecordActionBarAction {
  key?: string;
  label: string;
  icon?: ReactNode;
  onClick(): void;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  title?: string;
}
interface RecordActionBarProps {
  status?: ReactNode;
  actions: RecordActionBarAction[];
}

describe('ActionBar ↔ record `action-bar` (M34/L12, 2.1.28)', () => {
  it('[entity:action-bar] takes exactly the record props and ActionBarAction type (host and published /ui alike)', () => {
    const checks: boolean[] = [];
    const a: Same<ActionBarProps, RecordActionBarProps> = true;
    const b: Same<ActionBarAction, RecordActionBarAction> = true;
    const c: Same<Published.ActionBarProps, RecordActionBarProps> = true;
    const d: Same<Published.ActionBarAction, RecordActionBarAction> = true;
    const e: Same<Published.ActionBarVariant, Published.ActionButtonVariant> = true;
    checks.push(a, b, c, d, e);
    expect(checks.every(Boolean)).toBe(true);
  });

  it('[entity:action-bar] renders every action through ActionButton — same markup as the catalog button', () => {
    const onSave = vi.fn();
    const actions: ActionBarAction[] = [
      { label: 'Export', onClick: () => {} },
      { label: 'Save', onClick: onSave, variant: 'primary' },
      { label: 'Run', onClick: () => {}, disabled: true, title: 'Nothing to run' },
    ];
    mount(createElement(ActionBar, { actions, status: '3 items' }));
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Export', 'Save', 'Run']);

    // Each button is exactly what ActionButton draws for the same entry (default variant secondary).
    // A fresh root per probe: re-rendering one root patches the previous button in place
    // (attribute order, happy-dom's stale shorthand longhands), which is not a first draw.
    const expected = actions.map((a) => {
      const probe = document.createElement('div');
      const probeRoot = createRoot(probe);
      act(() =>
        probeRoot.render(
          createElement(ActionButton, {
            label: a.label,
            onClick: a.onClick,
            variant: a.variant ?? 'secondary',
            disabled: a.disabled,
            title: a.title,
          }),
        ),
      );
      const html = probe.innerHTML;
      act(() => probeRoot.unmount());
      return html;
    });
    expect(buttons.map((b) => b.outerHTML)).toEqual(expected);

    // disabled + tooltip come from the entry; a click is the consumer's callback.
    expect(buttons[2]!.disabled).toBe(true);
    expect(buttons[2]!.title).toBe('Nothing to run');
    act(() => buttons[1]!.click());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('[entity:action-bar] is a sticky bottom bar with the optional status text on the left', () => {
    mount(createElement(ActionBar, { actions: [{ label: 'Go', onClick: () => {} }], status: '0 selected' }));
    const bar = host.firstElementChild as HTMLElement;
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.bottom).toBe('0px');
    expect(bar.textContent?.startsWith('0 selected')).toBe(true);
    mount(createElement(ActionBar, { actions: [{ label: 'Go', onClick: () => {} }] }));
    expect(host.textContent).toBe('Go');
  });
});

describe('ActionBar — layer and entry defaults (M34/L12, 2.1.33)', () => {
  it('[entity:action-bar] carries its layer as the numeric constant 900 (token z-actionbar), not a bridge variable', () => {
    mount(createElement(ActionBar, { actions: [{ label: 'Go', onClick: () => {} }] }));
    const bar = host.firstElementChild as HTMLElement;
    expect(bar.style.zIndex).toBe('900');
    // The bridge exposes no `--z-actionbar`: the value is a number, never a var().
    expect(bar.getAttribute('style')).not.toMatch(/var\(--z-/);
    expect(bar.style.background).toBe('var(--c-card)');
    expect(bar.style.borderTop).toContain('var(--c-hair)');
  });

  it('[entity:action-bar] an entry without `variant` renders as secondary, and without `key` is keyed by its label', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount(
      createElement(ActionBar, {
        actions: [
          { label: 'Export', onClick: () => {} },
          { label: 'Save', onClick: () => {}, variant: 'primary' },
        ],
      }),
    );
    const [exportBtn, saveBtn] = Array.from(host.querySelectorAll('button'));
    // secondary = panel background; primary = accent.
    expect(exportBtn!.style.background).toBe('var(--c-panel)');
    expect(saveBtn!.style.background).toBe('var(--c-accent)');
    expect(errors).not.toHaveBeenCalled();

    // Two entries with the same label and no key collide: the key IS the label.
    mount(
      createElement(ActionBar, {
        actions: [
          { label: 'Dup', onClick: () => {} },
          { label: 'Dup', onClick: () => {} },
        ],
      }),
    );
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(true);
    errors.mockClear();
    // An explicit key wins over the label.
    act(() => root.unmount());
    root = createRoot(host);
    mount(
      createElement(ActionBar, {
        actions: [
          { key: 'a', label: 'Dup', onClick: () => {} },
          { key: 'b', label: 'Dup', onClick: () => {} },
        ],
      }),
    );
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
  });
});
