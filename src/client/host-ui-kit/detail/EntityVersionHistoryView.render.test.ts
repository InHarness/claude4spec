// @vitest-environment happy-dom
/**
 * 2.1.16 (M34 L12 `d97023iq` — `EntityVersionHistoryView`): the view has Diff
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
}));

vi.mock('../../hooks/useVersions.js', () => ({
  useVersions: () => state.list,
  useVersionDetail: (_type: string, _slug: string, version: number | null) => ({
    data: version != null && version in state.snapshots ? { version, data: state.snapshots[version] } : undefined,
  }),
  useRestoreVersion: () => ({ isPending: false, isError: false, error: null, mutate: () => {} }),
}));
vi.mock('../../hooks/useReleases.js', () => ({
  useReleases: () => new Map<number, string>(),
}));

import { EntityVersionHistoryView } from './EntityVersionHistoryView.js';
import { ApiError } from '../../lib/api-core.js';

const notFound = () => new ApiError('NOT_FOUND', 'Entity not found', 404);
const serverError = () => new ApiError('INTERNAL', 'Internal server error', 500);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function setList(next: ListResult) {
  state.list = next;
}

async function render() {
  await act(async () => {
    root.render(createElement(EntityVersionHistoryView, { type: 'dto', slug: 'user-dto' }));
  });
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
