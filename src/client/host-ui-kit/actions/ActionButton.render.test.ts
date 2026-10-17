// @vitest-environment happy-dom
/**
 * M34/L12 — `ActionButton` (group `actions`, `experimental`) against its
 * `ui-kit-component` record `action-button` (2.1.28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ActionButton, type ActionButtonProps, type ActionButtonVariant } from './ActionButton.js';
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

interface RecordActionButtonProps {
  label: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}

const button = () => host.querySelector('button')!;

describe('ActionButton ↔ record `action-button` (M34/L12, 2.1.28)', () => {
  it('[entity:action-button] takes exactly the record props; ActionButtonVariant is primary | secondary | ghost', () => {
    const a: Same<ActionButtonProps, RecordActionButtonProps> = true;
    const b: Same<Published.ActionButtonProps, RecordActionButtonProps> = true;
    const c: Same<ActionButtonVariant, 'primary' | 'secondary' | 'ghost'> = true;
    const d: Same<Published.ActionButtonVariant, 'primary' | 'secondary' | 'ghost'> = true;
    expect([a, b, c, d]).toEqual([true, true, true, true]);
  });

  it('[entity:action-button] defaults: variant secondary, type button, enabled', () => {
    const onClick = vi.fn();
    mount(createElement(ActionButton, { label: 'Export', onClick }));
    expect(button().type).toBe('button');
    expect(button().disabled).toBe(false);
    expect(button().style.background).toBe('var(--c-panel)');
    act(() => button().click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('[entity:action-button] the three variants draw primary filled accent, secondary panel, ghost transparent muted', () => {
    mount(createElement(ActionButton, { label: 'A', variant: 'primary' }));
    expect(button().style.background).toBe('var(--c-accent)');
    mount(createElement(ActionButton, { label: 'A', variant: 'ghost' }));
    expect(button().style.background).toBe('transparent');
    expect(button().style.color).toBe('var(--c-muted)');
  });

  it('[entity:action-button] disabled with a title tooltip; type submit; icon before the label', () => {
    const onClick = vi.fn();
    mount(
      createElement(ActionButton, {
        label: 'Run',
        onClick,
        disabled: true,
        title: 'Nothing to run',
        type: 'submit',
        icon: createElement('i', { 'data-testid': 'icon' }),
      }),
    );
    expect(button().disabled).toBe(true);
    expect(button().title).toBe('Nothing to run');
    expect(button().type).toBe('submit');
    expect(button().firstElementChild?.getAttribute('data-testid')).toBe('icon');
    expect(button().textContent).toBe('Run');
    act(() => button().click());
    expect(onClick).not.toHaveBeenCalled();
  });
});
