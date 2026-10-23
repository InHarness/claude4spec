// @vitest-environment happy-dom
/**
 * 2.1.45 (M25 L2 49dzhz9l, L5 cqhywf9z) — the M25 banner „You have N unreleased
 * changes — they will NOT be included in this push. Pull them into this release
 * or create a new one.” on the release card (`release-detail`):
 * - on the newest release on the axis it shows while the unreleased counter
 *   (the shared `useUnreleasedCount`, M17 zbc9jdnr) is above 0, N being that
 *   counter;
 * - on an older (frozen) release it is never shown;
 * - after a successful „Pull in unreleased changes” it goes away: the server
 *   broadcasts `release:updated`, the watcher refetches the counter, N is 0.
 *
 * The page, the release hooks, the shared counter query and the WS watcher are
 * real; only the network (`fetch`, `WebSocket`), the router and the page's
 * unrelated children (diff render, pickers, push log, brief dialog, the push
 * action's account/config hooks) are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    Link: ({ children }: { children?: unknown }) => React.createElement('a', null, children as never),
    useNavigate: () => async () => {},
  };
});
vi.mock('../hooks/useReleasePushes.js', () => ({
  releasePushesKey: (releaseName: string | undefined) => ['release-pushes', { releaseName }],
  useReleasePushes: () => ({ data: [] }),
  useAllReleasePushes: () => ({ data: [] }),
  usePushRelease: () => ({ isPending: false, mutateAsync: async () => ({}) }),
}));
vi.mock('../hooks/useConfig.js', () => ({ useConfig: () => ({ data: { name: 'p', remoteProjectId: null } }) }));
vi.mock('../hooks/useRemoteAccount.js', () => ({
  useRemoteAccount: () => ({ data: { connected: true, accountStatus: 'active' } }),
}));
vi.mock('./release/DeltaSection.js', () => ({ DeltaSection: () => null }));
vi.mock('./release/ReleaseSelect.js', () => ({ ReleaseSelect: () => null }));
vi.mock('./release/ReleasePushesList.js', () => ({ ReleasePushesList: () => null }));
vi.mock('./CreateBriefDialog.js', () => ({ CreateBriefDialog: () => null }));
// The watcher's plugin branches are not exercised here; keep their runtimes out.
vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getAvailable: () => undefined, listEntities: () => [], listAvailable: () => [] },
}));
vi.mock('../lib/project-reload.js', () => ({ reloadProjectRoute: () => {} }));

import { ReleaseDetail } from './ReleaseDetail.js';
import { useFileWatcher } from '../hooks/useFileWatcher.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal WebSocket double: the test plays the server's broadcasts through `emit`. */
class FakeSocket {
  static last: FakeSocket | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  close() {}
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const BANNER_TEXT = (n: number) =>
  `You have ${n} unreleased changes — they will NOT be included in this push. Pull them into this release or create a new one.`;

const release = (id: number, name: string) => ({
  id,
  name,
  slug: name,
  description: `Release ${name}`,
  createdBy: 'user',
  createdAt: `2026-10-0${id}T10:00:00.000Z`,
});
const detail = (id: number, name: string) => ({
  ...release(id, name),
  countBreakdown: { entities: {}, pages: 1, total: 1 },
});

/** Newest first, as `GET /api/releases` answers. */
let releaseList: Array<ReturnType<typeof release>>;
/** `total` of the light map newest → current — what the counter sums. */
let summaryTotal: { entities: number; pages: number };
let fetchMock: ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

const paths = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: String(url).replace(/^\/api\/projects\/[^/]+/, '/api'),
    method: ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
  }));
const counterRequests = () => paths().filter((r) => r.path.includes('?view=operation&summaryOnly=true'));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The page as the app mounts it: under the app-wide WS watcher. */
function Screen({ name }: { name: string }) {
  useFileWatcher();
  return createElement(ReleaseDetail, { name });
}

async function mount(name: string) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Screen, { name })));
  });
  // release list → detail + counter (dependent query) → settled.
  for (let i = 0; i < 5; i += 1) await settle();
}

/** The release on the card: an editable name on the newest release, plain text on older ones. */
function cardName(): string | undefined {
  const input = host.querySelector<HTMLInputElement>('input[title^="Click to rename"]');
  if (input) return input.value;
  return host.querySelector('h2')?.textContent ?? undefined;
}
const isEditable = () => host.querySelector('input[title^="Click to rename"]') !== null;

const banner = () => host.querySelector<HTMLElement>('[data-testid="unreleased-banner"]');

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`button "${label}" not rendered`);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  releaseList = [release(2, 'v2'), release(1, 'v1')];
  summaryTotal = { entities: 2, pages: 3 };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/api/releases' && method === 'GET') return json({ releases: releaseList });
    if (path.endsWith('?view=operation&summaryOnly=true')) {
      return json({ data: { total: summaryTotal, entities: [], pages: [] } });
    }
    if (/\/diff\/[^/]+$/.test(path)) return json({ from: null, to: { id: 2, name: 'v2' }, entities: [], pages: [] });
    if (/\/snapshot$/.test(path)) return json({ entities: [], pages: [] });
    const one = path.match(/^\/api\/releases\/([^/?]+)$/);
    if (one) {
      const name = decodeURIComponent(one[1]!);
      const r = releaseList.find((x) => x.name === name)!;
      if (method === 'PATCH') {
        // The pull: every unreleased version now belongs to the newest release,
        // so the light delta newest → current is empty.
        summaryTotal = { entities: 0, pages: 0 };
        return json({ ...detail(r.id, r.name), gitSync: null });
      }
      return json(detail(r.id, r.name));
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeSocket);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  qc.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.last = null;
});

describe('release card — M25 unreleased-changes banner (2.1.45)', () => {
  it("[ac:ac-ui-banner-you-have-n-unreleased-changes] the banner \"You have N unreleased changes\" shows on the newest release's card while the unreleased counter is above 0, N being that counter", async () => {
    await mount('v2');

    // The newest release's card (the only editable one).
    expect(cardName()).toBe('v2');
    expect(isEditable()).toBe(true);
    expect(banner()?.textContent).toBe(BANNER_TEXT(5));
    // N comes from the shared counter query — the light delta of the newest release.
    expect(counterRequests().map((r) => r.path)).toEqual([
      '/api/releases/v2/diff/current?view=operation&summaryOnly=true',
    ]);
    expect(qc.getQueryData(['release-diff', 'v2', 'current', { summaryOnly: true }])).toBe(5);
  });

  it('[ac:ac-ui-banner-you-have-n-unreleased-changes] no banner on the newest release while the unreleased counter is 0', async () => {
    summaryTotal = { entities: 0, pages: 0 };
    await mount('v2');

    expect(cardName()).toBe('v2');
    expect(counterRequests()).toHaveLength(1);
    expect(banner()).toBeNull();
    expect(host.textContent).not.toContain('unreleased change');
  });

  it('[ac:ac-na-release-ie-starszym-niz-najnowszy] on a release older than the newest the banner is not shown, even with unreleased changes', async () => {
    await mount('v1');

    // An older, frozen release: read-only name, no banner (the server has 5 unreleased changes).
    expect(cardName()).toBe('v1');
    expect(isEditable()).toBe(false);
    expect(banner()).toBeNull();
    expect(host.textContent).not.toContain('unreleased change');

    // …the same project on its newest release's card does show the banner.
    act(() => root.unmount());
    root = createRoot(host);
    await mount('v2');
    expect(banner()?.textContent).toBe(BANNER_TEXT(5));
  });

  it("[ac:ac-po-udanym-pull-in-unreleased-changes] after a successful \"Pull in unreleased changes\" the banner disappears from the newest release's card", async () => {
    await mount('v2');
    expect(banner()?.textContent).toBe(BANNER_TEXT(5));
    expect(FakeSocket.last).not.toBeNull();

    await act(async () => {
      (host.querySelector('button[title="Release actions"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      button('Pull in unreleased changes').click();
    });
    for (let i = 0; i < 3; i += 1) await settle();
    expect(paths()).toContainEqual({ path: '/api/releases/v2', method: 'PATCH' });

    // The server broadcasts the edit of the release; the watcher refreshes the
    // counter in its 500 ms batch window.
    act(() => FakeSocket.last!.emit({ kind: 'release:updated', releaseId: 2, name: 'v2' }));
    await settle(500);
    for (let i = 0; i < 3; i += 1) await settle();

    expect(qc.getQueryData(['release-diff', 'v2', 'current', { summaryOnly: true }])).toBe(0);
    expect(banner()).toBeNull();
    expect(host.textContent).not.toContain('unreleased change');
    // The pull ran on the newest release, which is still the card on screen.
    expect(cardName()).toBe('v2');
  });
});
