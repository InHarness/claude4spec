// @vitest-environment happy-dom
/**
 * 2.1.49 (M17 L5 m17ui001 "Stan → Zapytania") — the release list on
 * `releases-list` has its own query key `['releases']` (from
 * `GET /api/releases`). What refreshes it:
 *
 * - a `file:changed` in the `releases` root (the WS map row
 *   "`file:changed` w korzeniu `releases` → `['releases']`");
 * - directly, the create, edit and push mutations of a release.
 *
 * `release:created` and `release:updated` do NOT invalidate it (they reach the
 * release diff only). Driven through the real `useFileWatcher` socket handler
 * and the real mutation hooks; `fetch` and `WebSocket` are doubles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../lib/project-reload.js', () => ({ reloadProjectRoute: () => {} }));
vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getAvailable: () => undefined, listEntities: () => [] },
}));

import { useFileWatcher } from './useFileWatcher.js';
import { useAcceptShadow, useCreateRelease, useReleaseList, useUpdateRelease } from './useReleases.js';
import { usePushRelease } from './useReleasePushes.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal WebSocket double: the test plays server events through `emit`. */
class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
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

const RELEASE = {
  id: 1,
  name: 'v1',
  description: 'first',
  createdBy: 'user',
  createdAt: '2026-10-01T00:00:00.000Z',
  acceptedShadow: null,
  countBreakdown: { entities: {}, pages: 0, total: 0 },
  gitSync: null,
};

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
/** When set, a POST/PATCH of a release waits here, so the test can play its echo in flight. */
let hold: null | { release: null | (() => void) } = null;
/** When set, a POST/PATCH of a release answers 409 (after the hold). */
let conflict = false;
/** GET /api/releases — the fetches of the release list query. */
const listFetches = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/api/releases') && ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET',
  ).length;

const mutations: {
  create?: ReturnType<typeof useCreateRelease>;
  update?: ReturnType<typeof useUpdateRelease>;
  push?: ReturnType<typeof usePushRelease>;
  accept?: ReturnType<typeof useAcceptShadow>;
} = {};

function Probe() {
  useFileWatcher();
  useReleaseList();
  mutations.create = useCreateRelease();
  mutations.update = useUpdateRelease();
  mutations.push = usePushRelease();
  mutations.accept = useAcceptShadow({ onSuccess: () => {}, onError: () => {} });
  return null;
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Past the watcher's 500 ms batch window, then the refetch. */
async function afterBatch() {
  await settle(500);
  await settle();
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    let body: unknown = {};
    if (/\/api\/(releases(\/v1)?|shadow-accept)$/.test(u) && (method === 'POST' || method === 'PATCH')) {
      if (hold) await new Promise<void>((r) => (hold!.release = r));
      if (conflict) {
        return new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'name taken' } }), { status: 409 });
      }
    }
    if (u.endsWith('/api/releases') && method === 'GET') body = { releases: [RELEASE] };
    else if (u.endsWith('/api/releases') && method === 'POST') body = RELEASE;
    else if (u.endsWith('/api/shadow-accept') && method === 'POST') body = { ...RELEASE, acceptedShadow: { id: 'run-1/spec', tipSha: 'abc' } };
    else if (u.endsWith('/api/releases/v1') && method === 'PATCH') body = { ...RELEASE, description: 'edited' };
    else if (u.endsWith('/api/release-pushes') && method === 'POST') body = { id: 1, releaseId: 1, release: { id: 1, name: 'v1' }, gitSync: null };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeSocket);
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  hold = null;
  conflict = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.last = null;
});

describe("the release list query ['releases'] (M17 m17ui001, 2.1.49)", () => {
  it("[section:m17ui001] a file:changed in the releases root refetches ['releases']; release:created and release:updated do not", async () => {
    await mount();
    expect(listFetches()).toBe(1);

    act(() => FakeSocket.last!.emit({ kind: 'release:created', releaseId: 2, name: 'v2' }));
    await afterBatch();
    act(() => FakeSocket.last!.emit({ kind: 'release:updated', releaseId: 2, name: 'v2b' }));
    await afterBatch();
    expect(listFetches()).toBe(1);

    act(() =>
      FakeSocket.last!.emit({ kind: 'file:changed', event: 'change', path: 'v2.json', rootId: 'releases', origin: 'server' }),
    );
    await afterBatch();
    expect(listFetches()).toBe(2);

    // A page change is not a change of the release list.
    act(() =>
      FakeSocket.last!.emit({ kind: 'file:changed', event: 'change', path: 'a.md', rootId: 'pages', origin: 'server' }),
    );
    await afterBatch();
    expect(listFetches()).toBe(2);
  });

  it("[section:m17ui001] the create, edit and push mutations of a release refetch ['releases'] directly, without a WS event", async () => {
    await mount();
    expect(listFetches()).toBe(1);

    await act(async () => {
      await mutations.create!.mutateAsync({ name: 'v1', description: 'first' });
    });
    await settle();
    expect(listFetches()).toBe(2);

    await act(async () => {
      await mutations.update!.mutateAsync({ releaseName: 'v1', description: 'edited' });
    });
    await settle();
    expect(listFetches()).toBe(3);

    await act(async () => {
      await mutations.push!.mutateAsync('v1');
    });
    await settle();
    expect(listFetches()).toBe(4);
  });

  /** Plays the release file store's echo(es) while the mutation's request is held, then answers it. */
  async function inFlight(run: () => Promise<unknown>, echoes: Array<{ event: 'change' | 'unlink'; path: string }>) {
    hold = { release: null };
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = run().catch(() => undefined);
    });
    await settle();
    expect(hold.release).not.toBeNull();
    for (const e of echoes) {
      act(() => FakeSocket.last!.emit({ kind: 'file:changed', ...e, rootId: 'releases', origin: 'server' }));
    }
    await act(async () => {
      hold!.release!();
      await settled;
    });
    hold = null;
    await afterBatch();
  }

  it("[section:m17ui001] the writing tab's own create, edit and shadow acceptance fetch the list ONCE: the file:changed echo broadcast before the answer is absorbed, the mutation's own invalidation refetches", async () => {
    await mount();
    expect(listFetches()).toBe(1);

    await inFlight(() => mutations.create!.mutateAsync({ name: 'v1', description: 'first' }), [
      { event: 'change', path: 'v1.json' },
    ]);
    expect(listFetches()).toBe(2);

    // Two echoes in one flight (what a rename broadcasts: unlink of the old file + change of the new one).
    await inFlight(() => mutations.update!.mutateAsync({ releaseName: 'v1', description: 'edited' }), [
      { event: 'unlink', path: 'v1.json' },
      { event: 'change', path: 'v1b.json' },
    ]);
    expect(listFetches()).toBe(3);

    await inFlight(
      () =>
        mutations.accept!.mutateAsync({
          ref: 'run-1/spec',
          name: 'v2',
          description: 'accepted',
          expectedTipSha: 'abc',
          expectedHeadSha: 'def',
        }),
      [{ event: 'change', path: 'v2.json' }],
    );
    expect(listFetches()).toBe(4);

    // With no own write in flight, the same event is somebody else's and refetches.
    act(() =>
      FakeSocket.last!.emit({ kind: 'file:changed', event: 'change', path: 'v9.json', rootId: 'releases', origin: 'server' }),
    );
    await afterBatch();
    expect(listFetches()).toBe(5);
  });

  it("[section:m17ui001] a failed own release write that absorbed a file:changed still refetches ['releases'] once — the absorbed event may be another writer's", async () => {
    await mount();
    expect(listFetches()).toBe(1);

    conflict = true;
    await inFlight(() => mutations.create!.mutateAsync({ name: 'v1', description: 'first' }), [
      { event: 'change', path: 'v2.json' },
    ]);
    expect(listFetches()).toBe(2);

    // A failure that absorbed nothing refetches nothing.
    await inFlight(() => mutations.create!.mutateAsync({ name: 'v1', description: 'first' }), []);
    expect(listFetches()).toBe(2);
  });
});
