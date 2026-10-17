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
}));

vi.mock('../../hooks/useVersions.js', () => ({
  useVersions: () => state.list,
  useVersionDetail: (_type: string, _slug: string, version: number | null) => ({
    data: version != null && version in state.snapshots ? { version, data: state.snapshots[version] } : undefined,
  }),
  useRestoreVersion: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: (...args: unknown[]) => state.restoreMutate(...args),
  }),
}));
vi.mock('../../hooks/useReleases.js', () => ({
  useReleases: () => state.releases,
}));

import { EntityVersionHistoryView, type EntityVersionHistoryViewProps } from './EntityVersionHistoryView.js';
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

  it('[ac:ac-allowrestore-false-ukrywa-akcje-rest] with allowRestore by default, restore runs the host useRestoreVersion hook', async () => {
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
      'version-group-release:2.1.0',
      'version-group-release:2.0.0',
    ]);
    const unreleased = host.querySelector('[data-testid="version-group-__unreleased__"]')!;
    expect(unreleased.textContent).toContain('Unreleased');
    expect(unreleased.textContent).toContain('v4');
    expect(unreleased.textContent).not.toContain('v3');

    // v4 active, v3 the default compare target → the 2.1.0 group is open.
    const r210 = host.querySelector('[data-testid="version-group-release:2.1.0"]')!;
    expect(r210.textContent).toContain('v3');
    expect(r210.textContent).toContain('v2');

    // The release name is the GROUP heading only — no per-row release pill.
    const names = Array.from(host.querySelectorAll('*')).filter(
      (n) => n.children.length === 0 && n.textContent === '2.1.0',
    );
    expect(names.length).toBe(1);
    expect(host.textContent).not.toContain('(unreleased)');
  });

  it('[ac:ac-w-widoku-entityversionhistoryview-wers] showReleasePill={false} keeps the grouping but heads each group "Release <id>"', async () => {
    await render({ showReleasePill: false });
    expect(groupIds()).toEqual([
      'version-group-__unreleased__',
      'version-group-release:Release 7',
      'version-group-release:Release 5',
    ]);
    expect(host.textContent).not.toContain('2.1.0');
  });
});
