// @vitest-environment happy-dom
/**
 * 2.1.55 (M17 ui-view `release-detail`, M25 removed) — the release card no
 * longer carries anything of the release push: no "Push to remote" entry in the
 * action area, no "Pushed" / "Pushed N×" badge next to the name, no "You have N
 * unreleased changes" banner on the newest release, no "Pushes" section, and the
 * screen asks nothing of `/api/release-pushes` or `/api/remote-project`. What the
 * view still states stays: the header (name, author and date, description,
 * capture counter), the built-in actions "Pull in unreleased changes" and
 * "Restore entire spec", the compare selector and "Generate brief".
 *
 * The data hooks are stubbed — the unreleased counter answers 5, so a banner
 * that read it would show — and `fetch` records every request; the page is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReleaseDetail as ReleaseDetailData } from '../../shared/entities.js';

const state = vi.hoisted(() => ({
  release: null as unknown,
  list: [] as unknown[],
}));

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    Link: ({ children }: { children?: unknown }) => React.createElement('a', null, children as never),
    useNavigate: () => async () => {},
  };
});
vi.mock('../hooks/useReleases.js', () => ({
  useRelease: () => ({ data: state.release, isLoading: false }),
  useReleaseList: () => ({ data: state.list }),
  useReleaseDiff: () => ({ data: undefined }),
  useReleaseSnapshot: () => ({ data: undefined }),
  useRestoreSpec: () => ({ mutateAsync: async () => {} }),
  useUnreleasedCount: () => ({ data: 5 }),
  forgetReleaseName: () => {},
  useUpdateRelease: () => ({ isPending: false, mutateAsync: async () => state.release }),
}));
vi.mock('./release/DeltaSection.js', () => ({ DeltaSection: () => null }));
vi.mock('./release/ReleaseSelect.js', () => ({ ReleaseSelect: () => null }));
vi.mock('./CreateBriefDialog.js', () => ({ CreateBriefDialog: () => null }));

import { ReleaseDetail } from './ReleaseDetail.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NEWEST: ReleaseDetailData = {
  id: 8,
  name: 'v2.1.55',
  description: 'Release push removed',
  createdBy: 'user',
  createdAt: '2026-10-27T10:00:00.000Z',
  acceptedShadow: null,
  countBreakdown: { entities: { endpoint: 2 }, pages: 1, total: 3 },
};
const OLDER: ReleaseDetailData = { ...NEWEST, id: 7, name: 'v2.1.54', description: 'Older release' };

let host: HTMLDivElement;
let root: Root;
let requests: string[];

async function mount(release: ReleaseDetailData, list: ReleaseDetailData[]) {
  state.release = release;
  state.list = list;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ReleaseDetail, { name: release.name })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function openActions(): Promise<string[]> {
  const menu = host.querySelector<HTMLButtonElement>('button[title="Release actions"]');
  expect(menu).not.toBeNull();
  await act(async () => {
    menu!.click();
  });
  const items = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (b) => b !== menu && b.closest('[class*="absolute"]') !== null,
  );
  return items.map((b) => b.textContent?.trim() ?? '');
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('release detail — no release push (M17 release-detail, 2.1.55)', () => {
  it('[entity:release-detail] the newest release: header and built-in actions only — no "Push to remote", no "Pushed" badge, no unreleased-changes banner, no "Pushes" section', async () => {
    await mount(NEWEST, [NEWEST, OLDER]);

    // What the view states: the header and the footer action.
    expect((host.querySelector('input') as HTMLInputElement | null)?.value).toBe('v2.1.55');
    expect(host.textContent).toContain('by user');
    expect(host.textContent).toContain('3 total captures');
    expect(host.textContent).toContain('Compare to:');
    expect(host.textContent).toContain('Generate brief from this release');

    // The action area holds the built-in actions and nothing of the push.
    expect(await openActions()).toEqual(['Pull in unreleased changes', 'Restore entire spec']);
    expect(host.textContent).not.toContain('Push to remote');

    // Nothing else of M25: no badge, no banner (the counter is 5), no push log.
    expect(host.textContent).not.toMatch(/Pushed/);
    expect(host.querySelector('[data-testid="unreleased-banner"]')).toBeNull();
    expect(host.textContent).not.toMatch(/You have \d+ unreleased|NOT be included in this push/);
    expect(host.textContent).not.toMatch(/\bPushes\b/);
    expect(requests.filter((u) => /release-pushes|remote-project/.test(u))).toEqual([]);
  });

  it('[entity:release-detail] an older (frozen) release: the same — "Pull in unreleased changes" is inactive with the frozen tooltip, and nothing of the push', async () => {
    await mount(OLDER, [NEWEST, OLDER]);

    expect(host.querySelector('h2')?.textContent).toBe('v2.1.54');
    expect(await openActions()).toEqual(['Pull in unreleased changes', 'Restore entire spec']);
    const pull = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Pull in unreleased changes',
    )!;
    expect(pull.disabled).toBe(true);
    expect(pull.getAttribute('title')).toBe('Frozen — pull only allowed on latest release');

    expect(host.textContent).not.toMatch(/Push to remote|Pushed|\bPushes\b|You have \d+ unreleased/);
    expect(requests.filter((u) => /release-pushes|remote-project/.test(u))).toEqual([]);
  });
});
