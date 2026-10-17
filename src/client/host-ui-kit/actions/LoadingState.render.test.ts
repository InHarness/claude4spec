// @vitest-environment happy-dom
/**
 * M34/L12 — `LoadingState` (group `actions`, `experimental`) against its
 * `ui-kit-component` record `loading-state` (2.1.28): a skeleton.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CSSProperties } from 'react';
import { LoadingState, type LoadingStateProps } from './LoadingState.js';
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

interface RecordLoadingStateProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  lines?: number;
  className?: string;
  style?: CSSProperties;
}

const bars = () => Array.from(host.querySelectorAll<HTMLElement>('.skeleton'));

describe('LoadingState ↔ record `loading-state` (M34/L12, 2.1.28)', () => {
  it('[entity:loading-state] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<LoadingStateProps, RecordLoadingStateProps> = true;
    const b: Same<Published.LoadingStateProps, RecordLoadingStateProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[entity:loading-state] defaults to one skeleton bar, width 100% and height 12px', () => {
    mount(createElement(LoadingState, {}));
    expect(bars()).toHaveLength(1);
    expect(bars()[0]!.style.width).toBe('100%');
    expect(bars()[0]!.style.height).toBe('12px');
  });

  it('[entity:loading-state] lines stacks N bars; radius, circle, className and style apply', () => {
    mount(createElement(LoadingState, { lines: 3, width: 120, height: '1em', radius: 2, className: 'mt-2' }));
    expect(bars()).toHaveLength(3);
    for (const b of bars()) {
      expect(b.style.width).toBe('120px');
      expect(b.style.height).toBe('1em');
      expect(b.style.borderRadius).toBe('2px');
      expect(b.className).toContain('mt-2');
    }
    mount(createElement(LoadingState, { circle: true, width: 24, height: 24, style: { opacity: 0.5 } }));
    expect(bars()[0]!.style.borderRadius).toBe('999px');
    expect(bars()[0]!.style.opacity).toBe('0.5');
  });
});
