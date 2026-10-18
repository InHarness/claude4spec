// @vitest-environment happy-dom
/**
 * M34/L12 — `VersionHistory` (group `detail`, `experimental`) against its
 * `ui-kit-component` record `version-history` (2.1.28): a version list rendered
 * from props only, `flat` by default, `timeline` with dots, the release label as
 * group heading and "Compare to"; an empty `versions` renders `EmptyState`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VersionHistory, type VersionHistoryItem, type VersionHistoryProps } from './VersionHistory.js';
import type * as Published from '../../../plugin-types/ui.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `types`: `VersionHistoryItem`. */
interface RecordVersionHistoryItem {
  id: string;
  label: string;
  createdAt: string;
  author?: string;
  releaseLabel?: string;
  changedBy?: 'user' | 'agent' | 'filesystem';
  summary?: string;
}
/** The record's `props`. */
interface RecordVersionHistoryProps {
  versions: RecordVersionHistoryItem[];
  activeVersion?: string;
  onSelect?: (id: string) => void;
  onRestore?: (id: string) => void;
  variant?: 'flat' | 'timeline';
  compareVersion?: string;
  onCompare?: (id: string) => void;
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

const mount = (props: VersionHistoryProps) => act(() => root.render(createElement(VersionHistory, props)));
const buttons = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === label);
const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));

const VERSIONS: VersionHistoryItem[] = [
  { id: '3', label: 'v3', createdAt: '2026-10-03', changedBy: 'user' },
  { id: '2', label: 'v2', createdAt: '2026-10-02', releaseLabel: 'Release 2.1.0', changedBy: 'agent', summary: 'renamed a field' },
  { id: '1', label: 'v1', createdAt: '2026-10-01', releaseLabel: 'Release 2.1.0', author: 'ann' },
];

describe('VersionHistory ↔ record `version-history` (M34/L12, 2.1.28)', () => {
  it('[entity:version-history] takes exactly the record props and the VersionHistoryItem type (host and published /ui alike)', () => {
    const a: Same<VersionHistoryProps, RecordVersionHistoryProps> = true;
    const b: Same<Published.VersionHistoryProps, RecordVersionHistoryProps> = true;
    const c: Same<VersionHistoryItem, RecordVersionHistoryItem> = true;
    const d: Same<Published.VersionHistoryItem, RecordVersionHistoryItem> = true;
    expect([a, b, c, d]).toEqual([true, true, true, true]);
  });

  it('[ac:ac-komponent-versionhistory-m34-experi] renders the versions from the prop only — select and restore are callbacks — without fetching', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onSelect = vi.fn();
    const onRestore = vi.fn();
    mount({ versions: VERSIONS, activeVersion: '3', onSelect, onRestore });

    expect(host.textContent).toContain('v3');
    expect(host.textContent).toContain('v2');
    expect(host.textContent).toContain('v1');
    expect(host.textContent).toContain('ann');
    click(Array.from(host.querySelectorAll('li')).find((li) => li.textContent?.includes('v2'))!);
    expect(onSelect).toHaveBeenCalledWith('2');
    // Restore on the non-active rows only.
    expect(buttons('Restore').length).toBe(2);
    click(buttons('Restore')[1]!);
    expect(onRestore).toHaveBeenCalledWith('1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-versionhistory-bez-podanego-variant-r] without a variant renders the flat list: one row per version, no release groups and no timeline dots', () => {
    mount({ versions: VERSIONS });
    expect(host.querySelectorAll('ul > li').length).toBe(3);
    expect(host.querySelector('[data-testid^="version-group-"]')).toBeNull();
    expect(host.querySelector('[data-timeline-dot]')).toBeNull();
    // Flat: the release label is not turned into a heading.
    expect(host.textContent).not.toContain('Unreleased');
    expect(buttons('Compare to')).toEqual([]);
  });

  it('[ac:ac-versionhistory-w-wariancie-variant-time] variant="timeline" lays each version out in two columns: a dot rail and the row', () => {
    mount({ versions: VERSIONS, variant: 'timeline', activeVersion: '2' });
    const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-timeline-row]'));
    // "Unreleased" (v3) is open; the release group holds the active v2, so it is open too.
    expect(rows.map((r) => r.getAttribute('data-timeline-row'))).toEqual(['3', '2', '1']);
    for (const row of rows) {
      expect(row.children.length).toBe(2);
      expect(row.children[0]!.hasAttribute('data-timeline-rail')).toBe(true);
      expect(row.children[0]!.querySelector('[data-timeline-dot]')).not.toBeNull();
    }
    // A connector joins the dots inside a group (not after the last row).
    expect(rows[1]!.querySelector('[data-timeline-connector]')).not.toBeNull();
    expect(rows[2]!.querySelector('[data-timeline-connector]')).toBeNull();
    // The active version's dot is the accent one.
    expect(rows[1]!.querySelector('[data-timeline-dot]')!.getAttribute('style')).toContain('var(--c-accent)');
  });

  it('[ac:ac-versionhistory-z-variant-timeline-ren] variant="timeline" renders the release label slot as the heading of its version group, "Unreleased" on top', () => {
    mount({ versions: VERSIONS, variant: 'timeline' });
    const groups = Array.from(host.querySelectorAll<HTMLElement>('[data-testid^="version-group-"]'));
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual([
      'version-group-__unreleased__',
      'version-group-release:Release 2.1.0',
    ]);
    const heading = groups[1]!.querySelector(':scope > button')!;
    expect(heading.textContent).toContain('Release 2.1.0');
    // The label heads the group; the rows inside do not repeat it.
    const labelLeaves = Array.from(host.querySelectorAll('*')).filter(
      (n) => n.children.length === 0 && n.textContent === 'Release 2.1.0',
    );
    expect(labelLeaves.length).toBe(1);
  });

  it('[entity:version-history] timeline "Compare to" is only expressed — it calls onCompare and marks compareVersion, computing nothing', () => {
    const onCompare = vi.fn();
    mount({ versions: VERSIONS, variant: 'timeline', activeVersion: '3', compareVersion: '2', onCompare });
    expect(buttons('Comparing').length).toBe(1);
    click(buttons('Compare to')[0]!);
    expect(onCompare).toHaveBeenCalledWith('3');
    // The timeline badge tells agent from user.
    expect(host.textContent).toContain('agent');
  });

  it('[ac:ac-versionhistory-z-pustym-propsem-versi] an empty versions prop renders its own empty state (placeholder), not an error', () => {
    mount({ versions: [] });
    expect(host.textContent).toContain('No versions yet');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    mount({ versions: [], variant: 'timeline' });
    expect(host.textContent).toContain('No versions yet');
    expect(host.querySelector('[data-testid^="version-group-"]')).toBeNull();
  });
});

describe('VersionHistory — restore, "Unreleased" and no release mapping (M34/L12, 2.1.33)', () => {
  it('[entity:version-history] with onRestore every row except activeVersion gets a restore button, in flat and in timeline', () => {
    const onRestore = vi.fn();
    for (const variant of ['flat', 'timeline'] as const) {
      act(() => root.unmount());
      root = createRoot(host);
      mount({ versions: VERSIONS, activeVersion: '3', onRestore, variant });
      // Timeline groups: open them all so every row is visible.
      for (const g of Array.from(host.querySelectorAll<HTMLElement>('[data-open="false"] > button'))) click(g);
      expect(buttons('Restore')).toHaveLength(2);
      click(buttons('Restore')[0]!);
      expect(onRestore).toHaveBeenLastCalledWith('2');
    }
    // Without onRestore no row has one.
    mount({ versions: VERSIONS, activeVersion: '3', variant: 'flat' });
    expect(buttons('Restore')).toHaveLength(0);
  });

  it('[entity:version-history] an item without releaseLabel or with an empty one goes to "Unreleased", pinned on top', () => {
    mount({
      variant: 'timeline',
      versions: [
        { id: '4', label: 'v4', createdAt: '2026-10-04', releaseLabel: 'Release 2.1.1' },
        { id: '3', label: 'v3', createdAt: '2026-10-03', releaseLabel: '' },
        { id: '2', label: 'v2', createdAt: '2026-10-02' },
      ],
    });
    const groups = Array.from(host.querySelectorAll('[data-testid^="version-group-"]'));
    expect(groups[0]!.getAttribute('data-testid')).toBe('version-group-__unreleased__');
    expect(groups[0]!.textContent).toContain('v3');
    expect(groups[0]!.textContent).toContain('v2');
    expect(groups[1]!.getAttribute('data-testid')).toBe('version-group-release:Release 2.1.1');
  });

  it('[entity:version-history] maps nothing: VersionHistoryItem has no releaseId, the releaseLabel the consumer gives is the group heading verbatim', () => {
    const noReleaseId: 'releaseId' extends keyof VersionHistoryItem ? false : true = true;
    expect(noReleaseId).toBe(true);
    mount({
      variant: 'timeline',
      activeVersion: '1',
      versions: [{ id: '1', label: 'v1', createdAt: '2026-10-01', releaseLabel: 'Whatever the consumer says' }],
    });
    expect(host.querySelector('[data-testid="version-group-release:Whatever the consumer says"]')!.textContent).toContain(
      'Whatever the consumer says',
    );
  });
});
