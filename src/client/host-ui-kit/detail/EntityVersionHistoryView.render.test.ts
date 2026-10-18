// @vitest-environment happy-dom
/**
 * 2.1.16 (the `ui-kit-component` record `entity-version-history-view`): the view has Diff
 * and Snapshot tabs, Snapshot shows the selected version as formatted JSON, and
 * a deleted entity shows the empty history state (no tombstone view).
 *
 * The L11 hooks are mocked: the block's contract is what it renders from them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type ListResult = { data?: unknown[]; isLoading: boolean; isError: boolean; error?: unknown };

const state = vi.hoisted(() => ({
  list: { data: [], isLoading: false, isError: false } as {
    data?: unknown[];
    isLoading: boolean;
    isError: boolean;
    error?: unknown;
  },
  snapshots: {} as Record<number, unknown>,
  releases: new Map<number, string>(),
  restoreMutate: (() => {}) as (...args: unknown[]) => void,
  restoreError: null as Error | null,
}));

vi.mock('../../hooks/useVersions.js', () => ({
  useVersions: () => state.list,
  useVersionDetail: (_type: string, _slug: string, version: number | null) => ({
    data: version != null && version in state.snapshots ? { version, data: state.snapshots[version] } : undefined,
  }),
  useRestoreVersion: () => ({
    isPending: false,
    isError: state.restoreError != null,
    error: state.restoreError,
    mutate: (...args: unknown[]) => state.restoreMutate(...args),
  }),
}));
vi.mock('../../hooks/useReleases.js', () => ({
  useReleases: () => state.releases,
}));

import { EntityVersionHistoryView, releaseGroupHeading, type EntityVersionHistoryViewProps } from './EntityVersionHistoryView.js';
import type { DiffViewLine } from './DiffView.js';
import type { ReactNode } from 'react';
import type * as Published from '../../../plugin-types/ui.js';

/** Mutual assignability + the same key set: the record's prop list, no more, no less. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;

/** The record's `props` (`entity-version-history-view`, 2.1.28). */
interface RecordEntityVersionHistoryViewProps {
  type: string;
  slug: string;
  allowRestore?: boolean;
  allowCompare?: boolean;
  showReleasePill?: boolean;
  emptyState?: ReactNode;
  renderDiff?: (hunks: DiffViewLine[]) => ReactNode;
  onRestored?: (versionId: string) => void;
}
import { ApiError } from '../../lib/api-core.js';

const notFound = () => new ApiError('NOT_FOUND', 'Entity not found', 404);
const serverError = () => new ApiError('INTERNAL', 'Internal server error', 500);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function setList(next: ListResult) {
  state.list = next;
}

async function render(extra: Partial<EntityVersionHistoryViewProps> = {}) {
  await act(async () => {
    root.render(createElement(EntityVersionHistoryView, { type: 'dto', slug: 'user-dto', ...extra }));
  });
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === label);
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function byText(text: string): HTMLElement {
  const el = Array.from(host.querySelectorAll<HTMLElement>('*')).find(
    (n) => n.children.length === 0 && n.textContent === text,
  );
  if (!el) throw new Error(`no element with text ${text}`);
  return el;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  state.snapshots = {};
  state.releases = new Map();
  state.restoreMutate = () => {};
  state.restoreError = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('EntityVersionHistoryView (M34)', () => {
  const v1 = { name: 'UserDto', fields: [{ name: 'id', type: 'string' }] };
  const v2 = { name: 'UserDto', fields: [{ name: 'id', type: 'uuid' }] };

  beforeEach(() => {
    setList({
      data: [
        { version: 2, changedBy: 'agent', changeSummary: 'id → uuid', createdAt: '2026-10-02T10:00:00Z' },
        { version: 1, changedBy: 'user', changeSummary: null, createdAt: '2026-10-01T10:00:00Z' },
      ],
      isLoading: false,
      isError: false,
    });
    state.snapshots = { 1: v1, 2: v2 };
  });

  it('renders Diff and Snapshot tabs', async () => {
    await render();
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(['Diff', 'Snapshot']);
  });

  it('keeps the cached timeline when a background refetch fails (isError with cached data)', async () => {
    const cached = state.list.data;
    setList({ data: cached, isLoading: false, isError: true, error: serverError() });
    await render();

    expect(host.textContent).not.toContain('No versions yet');
    expect(host.textContent).toContain('v2');
    expect(host.textContent).toContain('v1');
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('[ac:ac-entityversionhistoryview-pokazuje-w-z] the Snapshot tab shows the selected version as formatted JSON', async () => {
    await render();
    // Select the OLDER version, so the assertion cannot pass on the default (newest).
    await click(byText('v1'));
    const snapshotTab = Array.from(host.querySelectorAll('[role="tab"]')).find((t) => t.textContent === 'Snapshot')!;
    await click(snapshotTab);

    expect(snapshotTab.getAttribute('aria-selected')).toBe('true');
    const pre = host.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(JSON.stringify(v1, null, 2));
    expect(pre!.textContent).not.toBe(JSON.stringify(v2, null, 2));
  });
});

describe('EntityVersionHistoryView on a deleted entity (M34)', () => {
  it('[ac:ac-entityversionhistoryview-otwarty-dla] shows the empty history state', async () => {
    // A deleted entity: its versions endpoint answers 404, so the list query errors.
    setList({ data: undefined, isLoading: false, isError: true, error: notFound() });
    await render();

    expect(host.textContent).toContain('No versions yet');
    // The empty state, not a tombstone or a timeline/tabs view of the deleted entity.
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('pre')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent?.toLowerCase()).not.toContain('deleted');
  });

  it('[ac:ac-entityversionhistoryview-otwarty-dla] renders the caller emptyState when one is given', async () => {
    setList({ data: undefined, isLoading: false, isError: true, error: notFound() });
    await act(async () => {
      root.render(
        createElement(EntityVersionHistoryView, {
          type: 'dto',
          slug: 'gone-dto',
          emptyState: createElement('p', { 'data-testid': 'custom-empty' }, 'Nothing here'),
        }),
      );
    });
    expect(host.querySelector('[data-testid="custom-empty"]')?.textContent).toBe('Nothing here');
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });

  it('a non-404 failure with nothing cached shows an error, not the empty history', async () => {
    setList({ data: undefined, isLoading: false, isError: true, error: serverError() });
    await render();

    expect(host.textContent).not.toContain('No versions yet');
    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('Internal server error');
  });
});

describe('EntityVersionHistoryView restore (M34)', () => {
  beforeEach(() => {
    setList({
      data: [
        { version: 3, changedBy: 'user', changeSummary: null, createdAt: '2026-10-03T10:00:00Z' },
        { version: 2, changedBy: 'agent', changeSummary: null, createdAt: '2026-10-02T10:00:00Z' },
        { version: 1, changedBy: 'user', changeSummary: null, createdAt: '2026-10-01T10:00:00Z' },
      ],
      isLoading: false,
      isError: false,
    });
    state.snapshots = { 1: { n: 1 }, 2: { n: 2 }, 3: { n: 3 } };
  });

  it('[ac:ac-allowrestore-false-ukrywa-akcje-rest] allowRestore={false} hides the restore action', async () => {
    await render({ allowRestore: false });
    // The timeline is rendered (so the absence is not just an empty view)…
    expect(host.textContent).toContain('v2');
    expect(buttons('Compare to').length).toBeGreaterThan(0);
    // …but no row offers Restore.
    expect(buttons('Restore')).toEqual([]);
  });

  it('[ac:ac-restore-w-entityversionhistoryview-pr] with allowRestore by default, restore runs the host useRestoreVersion hook, not a mutation of its own nor author code', async () => {
    const calls: unknown[][] = [];
    state.restoreMutate = (...args) => calls.push(args);
    const restored: string[] = [];
    await render({ onRestored: (id: string) => restored.push(id) });

    const restore = buttons('Restore');
    // Every non-active row (v2, v1) offers it; the active v3 does not.
    expect(restore.length).toBe(2);
    await click(restore[0]!);

    // The hook's mutation is what runs — with the entity identity and the row's
    // version — not a mutation of the component's own nor an author callback.
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toEqual({ type: 'dto', slug: 'user-dto', version: 2 });
    expect(restored).toEqual([]); // onRestored fires only on the hook's onSuccess
    const opts = calls[0]![1] as { onSuccess?: () => void };
    opts.onSuccess?.();
    expect(restored).toEqual(['2']);
  });

  it('[entity:entity-version-history-view] a failed restore ends with an error message', async () => {
    state.restoreError = new Error('Version 2 is gone');
    await render();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Restore failed');
    expect(alert?.textContent).toContain('Version 2 is gone');
  });
});

describe('EntityVersionHistoryView release grouping (M34)', () => {
  beforeEach(() => {
    setList({
      data: [
        { version: 4, changedBy: 'user', changeSummary: null, createdAt: '2026-10-04T10:00:00Z' },
        { version: 3, changedBy: 'agent', changeSummary: null, createdAt: '2026-10-03T10:00:00Z', releaseId: 7 },
        { version: 2, changedBy: 'user', changeSummary: null, createdAt: '2026-10-02T10:00:00Z', releaseId: 7 },
        { version: 1, changedBy: 'user', changeSummary: null, createdAt: '2026-10-01T10:00:00Z', releaseId: 5 },
      ],
      isLoading: false,
      isError: false,
    });
    state.snapshots = { 1: { n: 1 }, 2: { n: 2 }, 3: { n: 3 }, 4: { n: 4 } };
    state.releases = new Map([
      [7, '2.1.0'],
      [5, '2.0.0'],
    ]);
  });

  function groupIds(): string[] {
    return Array.from(host.querySelectorAll('[data-testid^="version-group-"]')).map(
      (g) => g.getAttribute('data-testid')!,
    );
  }

  it('[ac:ac-w-widoku-entityversionhistoryview-wers] groups versions by release, unassigned ones in "Unreleased" at the top', async () => {
    await render();

    expect(groupIds()).toEqual([
      'version-group-__unreleased__',
      'version-group-release:Release 2.1.0',
      'version-group-release:Release 2.0.0',
    ]);
    const unreleased = host.querySelector('[data-testid="version-group-__unreleased__"]')!;
    expect(unreleased.textContent).toContain('Unreleased');
    expect(unreleased.textContent).toContain('v4');
    expect(unreleased.textContent).not.toContain('v3');

    // v4 active, v3 the default compare target → the 2.1.0 group is open.
    const r210 = host.querySelector('[data-testid="version-group-release:Release 2.1.0"]')!;
    expect(r210.textContent).toContain('v3');
    expect(r210.textContent).toContain('v2');

    // The release is the GROUP heading only — no per-row release pill.
    const names = Array.from(host.querySelectorAll('*')).filter(
      (n) => n.children.length === 0 && (n.textContent ?? '').includes('2.1.0'),
    );
    expect(names.length).toBe(1);
    expect(host.textContent).not.toContain('(unreleased)');
  });

  it('[ac:ac-entityversionhistoryview-przy-showrel] with showReleasePill (default) each release group is headed "Release <release name>"', async () => {
    await render();
    // The heading label of each release group, in axis order.
    const headings = Array.from(host.querySelectorAll('[data-testid^="version-group-release:"] > button > span')).map(
      (b) => b.textContent,
    );
    expect(headings.filter((t) => t?.startsWith('Release'))).toEqual(['Release 2.1.0', 'Release 2.0.0']);
    expect(releaseGroupHeading('2.1.0', true)).toBe('Release 2.1.0');
  });

  it('[ac:ac-entityversionhistoryview-dopoki-usere] until useReleases delivers the name, the numeric release id stands in its place', async () => {
    state.releases = new Map();
    await render({ showReleasePill: true });
    expect(groupIds()).toEqual([
      'version-group-__unreleased__',
      'version-group-release:Release 7',
      'version-group-release:Release 5',
    ]);
    await render({ showReleasePill: false });
    expect(groupIds()).toEqual(['version-group-__unreleased__', 'version-group-release:7', 'version-group-release:5']);
  });

  it('[ac:ac-w-widoku-entityversionhistoryview-wers] showReleasePill={false} keeps the grouping, "Unreleased" on top, headed by the bare release name', async () => {
    await render({ showReleasePill: false });
    expect(groupIds()).toEqual([
      'version-group-__unreleased__',
      'version-group-release:2.1.0',
      'version-group-release:2.0.0',
    ]);
    expect(host.textContent).not.toContain('Release 2.1.0');
  });

  it('[ac:ac-entityversionhistoryview-przy-showrel-2] with showReleasePill={false} the release group heading is the bare release name', async () => {
    await render({ showReleasePill: false });
    const headings = Array.from(host.querySelectorAll('[data-testid^="version-group-release:"] > button > span')).map(
      (b) => b.textContent,
    );
    expect(headings).toContain('2.1.0');
    expect(headings).toContain('2.0.0');
    expect(releaseGroupHeading('2.1.0', false)).toBe('2.1.0');
  });
});

describe('EntityVersionHistoryView ↔ record `entity-version-history-view` (M34/L12, 2.1.28)', () => {
  const v1 = { name: 'UserDto', fields: ['id'] };
  const v2 = { name: 'UserDto', fields: ['id', 'email'] };

  beforeEach(() => {
    setList({
      data: [
        { version: 2, changedBy: 'agent', changeSummary: 'add email', createdAt: '2026-10-02T10:00:00Z' },
        { version: 1, changedBy: 'user', changeSummary: null, createdAt: '2026-10-01T10:00:00Z' },
      ],
      isLoading: false,
      isError: false,
    });
    state.snapshots = { 1: v1, 2: v2 };
  });

  it('[entity:entity-version-history-view] takes exactly the record props (host and published /ui alike)', () => {
    const a: Same<EntityVersionHistoryViewProps, RecordEntityVersionHistoryViewProps> = true;
    const b: Same<Published.EntityVersionHistoryViewProps, RecordEntityVersionHistoryViewProps> = true;
    expect([a, b]).toEqual([true, true]);
  });

  it('[ac:ac-entityversionhistoryview-renderuje-kom] from type and slug alone renders timeline, "Compare to", restore and the diff panel', async () => {
    await render();
    // Timeline: rows with dots, the release axis (here only "Unreleased").
    expect(host.querySelector('[data-testid="version-group-__unreleased__"]')).not.toBeNull();
    expect(host.textContent).toContain('v2');
    expect(host.textContent).toContain('v1');
    // "Compare to" and restore on the older row; the newest is active.
    expect(buttons('Comparing').length).toBe(1);
    expect(buttons('Restore').length).toBe(1);
    // Diff panel: the DiffView hunks of v1 → v2 computed by lineDiffHunks (an added line, no placeholder).
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Diff');
    expect(host.textContent).not.toContain('Nothing to compare');
    expect(host.textContent).toContain('"email"');
    // DiffView's add marker on the added line.
    const plus = Array.from(host.querySelectorAll('span')).filter((n) => n.children.length === 0 && n.textContent === '+');
    expect(plus.length).toBeGreaterThan(0);
  });

  it('[entity:entity-version-history-view] the EntityDetailToolbar carries the title only — no back, no delete', async () => {
    await render();
    expect(host.textContent).toContain('dto · user-dto');
    expect(host.querySelector('[aria-label="Back"]')).toBeNull();
    expect(buttons('Delete')).toEqual([]);
  });

  it('[entity:entity-version-history-view] renderDiff, when given, replaces the default DiffView with the hunks', async () => {
    const seen: DiffViewLine[][] = [];
    await render({
      renderDiff: (hunks) => {
        seen.push(hunks);
        return createElement('div', { 'data-testid': 'own-diff' }, `${hunks.length} lines`);
      },
    });
    expect(host.querySelector('[data-testid="own-diff"]')).not.toBeNull();
    expect(seen.at(-1)!.some((h) => h.op === 'add')).toBe(true);
    // The default DiffView is not rendered: the hunk lines are not in the panel.
    expect(host.textContent).not.toContain('"email"');
  });

  it('[ac:ac-entityversionhistoryview-bez-wybranej] with no version to compare against, the diff panel renders its placeholder, not an error', async () => {
    setList({
      data: [{ version: 1, changedBy: 'user', changeSummary: null, createdAt: '2026-10-01T10:00:00Z' }],
      isLoading: false,
      isError: false,
    });
    await render();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Diff');
    expect(host.textContent).toContain('Nothing to compare');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    // The rest of the view is there: it is a placeholder inside the view, not an empty view.
    expect(host.textContent).toContain('v1');
  });

  it('[ac:ac-entityversionhistoryview-dla-encji-bez] an entity with no versions renders the default empty state, not an error', async () => {
    setList({ data: [], isLoading: false, isError: false });
    await render();
    expect(host.textContent).toContain('No versions yet');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });

  it('[ac:ac-entityversionhistoryview-dla-encji-bez] an entity with no versions renders the given emptyState instead', async () => {
    setList({ data: [], isLoading: false, isError: false });
    await render({ emptyState: createElement('p', { 'data-testid': 'mine' }, 'Nothing yet') });
    expect(host.querySelector('[data-testid="mine"]')?.textContent).toBe('Nothing yet');
    expect(host.textContent).not.toContain('No versions yet');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('[ac:ac-badge-changedby-w-widoku-historii-ent] the changedBy badge of an agent row looks different from that of a user row', async () => {
    await render();
    const agent = byText('agent');
    const user = byText('user');
    expect(agent.getAttribute('style')).toContain('var(--c-blue');
    expect(user.getAttribute('style')).toContain('var(--c-green');
    expect(agent.getAttribute('style')).not.toBe(user.getAttribute('style'));
  });
});

describe('EntityVersionHistoryView — toolbar, empty default and "Unreleased" (M34/L12, 2.1.33)', () => {
  beforeEach(() => {
    setList({
      data: [
        { version: 3, releaseId: null, changedBy: 'agent', changeSummary: null, createdAt: '2026-10-03T10:00:00Z' },
        { version: 2, releaseId: 7, changedBy: 'user', changeSummary: null, createdAt: '2026-10-02T10:00:00Z' },
        { version: 1, releaseId: null, changedBy: 'user', changeSummary: null, createdAt: '2026-10-01T10:00:00Z' },
      ],
      isLoading: false,
      isError: false,
    });
    state.snapshots = { 1: { a: 1 }, 2: { a: 2 }, 3: { a: 3 } };
    state.releases = new Map([[7, '2.1.0']]);
  });

  it('[entity:entity-version-history-view] the toolbar title is "<type> · <slug>" and stands outside the scrolling area; the grid under it scrolls', async () => {
    await render({ type: 'endpoint', slug: 'get-users' });
    const title = byText('endpoint · get-users');
    expect(title.closest('.overflow-auto')).toBeNull();
    const row = host.querySelector('[data-timeline-row]')!;
    expect(row).not.toBeNull();
    expect(row.closest('.overflow-auto')).not.toBeNull();
  });

  it('[entity:entity-version-history-view] every version with releaseId null lands in the "Unreleased" group on top', async () => {
    await render();
    const groups = Array.from(host.querySelectorAll('[data-testid^="version-group-"]'));
    expect(groups[0]!.getAttribute('data-testid')).toBe('version-group-__unreleased__');
    const unreleased = groups[0]!;
    expect(unreleased.textContent).toContain('v3');
    expect(unreleased.textContent).toContain('v1');
    expect(unreleased.textContent).not.toContain('v2');
    expect(groups[1]!.getAttribute('data-testid')).toBe('version-group-release:Release 2.1.0');
  });

  it('[entity:entity-version-history-view] with no versions and no emptyState it renders EmptyState "No versions yet"', async () => {
    setList({ data: [], isLoading: false, isError: false });
    await render();
    expect(host.textContent).toContain('No versions yet');
    expect(host.querySelector('[data-timeline-row]')).toBeNull();
  });

  it('[entity:entity-version-history-view] while the list loads it renders LoadingState', async () => {
    setList({ data: undefined, isLoading: true, isError: false });
    await render();
    expect(host.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(host.textContent).not.toContain('No versions yet');
  });
});
