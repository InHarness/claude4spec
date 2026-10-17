// @vitest-environment happy-dom
/**
 * M34/L12 — `ToastViewport` (group `feedback`, `experimental`) against its
 * `ui-kit-component` record `toast-viewport` (2.1.28): a controlled stack
 * over `--z-toast` that reports a close through `onDismiss`; no timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ToastViewport,
  type ToastAction,
  type ToastKind,
  type ToastViewportItem,
  type ToastViewportProps,
} from './ToastViewport.js';
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

type RecordToastKind = 'success' | 'error' | 'warning' | 'info';
interface RecordToastAction {
  label: string;
  onClick(): void;
}
interface RecordToastViewportItem {
  id: number | string;
  kind: RecordToastKind;
  message: ReactNode;
  action?: RecordToastAction;
}
interface RecordToastViewportProps {
  toasts?: RecordToastViewportItem[];
  onDismiss?: (id: number | string) => void;
  onPause?: (id: number | string) => void;
  onResume?: (id: number | string) => void;
}

const toasts = () => Array.from(host.querySelectorAll<HTMLElement>('[role="status"]'));

describe('ToastViewport ↔ record `toast-viewport` (M34/L12, 2.1.28)', () => {
  it('[entity:toast-viewport] takes exactly the record props and types (host and published /ui alike)', () => {
    const checks = [
      ((): Same<ToastViewportProps, RecordToastViewportProps> => true)(),
      ((): Same<Published.ToastViewportProps, RecordToastViewportProps> => true)(),
      ((): Same<ToastViewportItem, RecordToastViewportItem> => true)(),
      ((): Same<Published.ToastViewportItem, RecordToastViewportItem> => true)(),
      ((): Same<ToastKind, RecordToastKind> => true)(),
      ((): Same<Published.ToastKind, RecordToastKind> => true)(),
      ((): Same<ToastAction, RecordToastAction> => true)(),
      ((): Same<Published.ToastAction, RecordToastAction> => true)(),
    ];
    expect(checks.every(Boolean)).toBe(true);
  });

  it('[entity:toast-viewport] renders the given toasts over --z-toast, bottom-right, and reports a close via onDismiss', () => {
    const onDismiss = vi.fn();
    mount(
      createElement(ToastViewport, {
        toasts: [
          { id: 1, kind: 'success', message: 'Saved' },
          { id: 'b', kind: 'error', message: 'Failed' },
        ],
        onDismiss,
      }),
    );
    const stack = host.firstElementChild as HTMLElement;
    expect(stack.getAttribute('style')).toContain('var(--z-toast)');
    expect(stack.style.position).toBe('fixed');
    expect(toasts().map((t) => t.textContent)).toEqual(['Saved', 'Failed']);
    act(() => toasts()[1]!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click());
    expect(onDismiss).toHaveBeenCalledWith('b');
    // Controlled: the stack only changes when the consumer passes new `toasts`.
    expect(toasts()).toHaveLength(2);
  });

  it('[entity:toast-viewport] an action button calls its onClick without dismissing; hover reports pause/resume', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    mount(
      createElement(ToastViewport, {
        toasts: [{ id: 7, kind: 'warning', message: 'Deleted', action: { label: 'Undo', onClick } }],
        onDismiss,
        onPause,
        onResume,
      }),
    );
    const undo = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Undo')!;
    act(() => undo.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      toasts()[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      toasts()[0]!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(onPause).toHaveBeenCalledWith(7);
    expect(onResume).toHaveBeenCalledWith(7);
  });

  it('[entity:toast-viewport] holds no queue or timers of its own — a toast stays until the consumer drops it', () => {
    vi.useFakeTimers();
    try {
      mount(createElement(ToastViewport, { toasts: [{ id: 1, kind: 'info', message: 'Hi' }] }));
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(toasts()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
    const src = readFileSync(fileURLToPath(new URL('./ToastViewport.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/setTimeout|setInterval|useState|useReducer/);
    mount(createElement(ToastViewport, {}));
    expect(host.innerHTML).toBe('');
  });
});
