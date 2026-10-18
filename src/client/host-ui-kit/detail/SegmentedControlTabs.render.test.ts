// @vitest-environment happy-dom
/**
 * M34/L12 — `SegmentedControlTabs` (group `detail`, `experimental`) against
 * its `ui-kit-component` record `segmented-control-tabs` (2.1.28): an in-panel
 * view switcher from `tabs` / `active` / `onChange`, pure-presentational.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SegmentedControlTabs, type SegmentedControlTabsProps } from './SegmentedControlTabs.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

interface RecordSegmentedControlTabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
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

const mount = (props: SegmentedControlTabsProps) =>
  act(() => root.render(createElement(SegmentedControlTabs, props)));
const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'history', label: 'History' },
];

describe('SegmentedControlTabs ↔ record `segmented-control-tabs` (M34/L12, 2.1.28)', () => {
  it('[entity:segmented-control-tabs] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<SegmentedControlTabsProps, RecordSegmentedControlTabsProps> = true;
    const b: Same<Published.SegmentedControlTabsProps, RecordSegmentedControlTabsProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[ac:ac-komponent-segmentedcontroltabs-grupa] renders the in-panel switcher from tabs/active and reports a pick through onChange, keeping no state of its own', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onChange = vi.fn();
    mount({ tabs: TABS, active: 'details', onChange });
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs.map((t) => t.textContent)).toEqual(['Details', 'History']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);

    act(() => tabs[1]!.click());
    expect(onChange).toHaveBeenCalledWith('history');
    // Pure-presentational: the active tab is the prop until the caller changes it.
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    mount({ tabs: TABS, active: 'history', onChange });
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
