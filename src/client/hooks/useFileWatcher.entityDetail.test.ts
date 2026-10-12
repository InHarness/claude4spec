// @vitest-environment happy-dom
/**
 * 2.1.19 (M13 m13ui000 "Stan — Zapytania", M50 wsmq8cpb) — the host's global
 * observer (`useFileWatcher`) owns the WS → query-key map for entity lists and
 * details. An entity written from outside (an agent, another tab) arrives as
 * `entity:changed` / `entity:indexed`; an open detail whose query sits on the
 * host convention `[<type>, slug]` refetches — no page reload, no plugin-side
 * socket. Version history (`['versions', <type>, slug]`) is not on the map.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: {
    getAvailable: (type: string) => (type === 'endpoint' ? { type, pathPrefix: '/endpoints' } : undefined),
    listEntities: () => [{ type: 'endpoint' }],
  },
}));

import { useFileWatcher } from './useFileWatcher.js';
import { entityChangeKeys } from '../lib/entity-invalidation.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal WebSocket double: the test plays server events through `emit`. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {}
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

/** What the server returns for the entity — mutated to play the external write. */
let stored = { slug: 'get-users', title: 'Before' };
const calls = { detail: 0, list: 0, versions: 0, other: 0 };

/** An open plugin detail route: its detail, list and history queries on the host convention. */
function OpenDetail() {
  useFileWatcher();
  const detail = useQuery({
    queryKey: ['endpoint', 'get-users'],
    queryFn: async () => {
      calls.detail += 1;
      return { ...stored };
    },
  });
  useQuery({
    queryKey: ['endpoints', { tags: [] }],
    queryFn: async () => {
      calls.list += 1;
      return [{ ...stored }];
    },
  });
  useQuery({
    queryKey: ['versions', 'endpoint', 'get-users'],
    queryFn: async () => {
      calls.versions += 1;
      return [];
    },
  });
  // A key of another shape is not on the host map.
  useQuery({
    queryKey: ['my-plugin-endpoint-detail', 'get-users'],
    queryFn: async () => {
      calls.other += 1;
      return null;
    },
  });
  return createElement('h1', null, detail.data?.title ?? '');
}

let host: HTMLDivElement;
let root: Root;

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * React Query flushes observer notifications through `setTimeout(cb, 0)`
 * (notifyManager). A timer scheduled while fake timers are ticking — the
 * batcher's flush starting the refetch — is placed at `now + 1`, so a 0 ms
 * advance never reaches it: advance past it so the refetched data reaches the
 * mounted detail.
 */
async function flushQueryNotifications() {
  await settle(1);
  await settle(1);
}

async function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(OpenDetail)));
  });
  await settle();
}

const socket = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  stored = { slug: 'get-users', title: 'Before' };
  calls.detail = calls.list = calls.versions = calls.other = 0;
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('host entity invalidation — open detail follows an external change', () => {
  it('[ac:ac-zmiana-encji-zapisana-z-zewnatrz-agen] entity:changed from an external write refreshes the open detail without a page reload', async () => {
    await mount();
    expect(host.textContent).toBe('Before');
    expect(calls.detail).toBe(1);
    const sockets = FakeSocket.instances.length;

    // The agent (or another tab) saves the entity; the server broadcasts.
    stored = { slug: 'get-users', title: 'After' };
    act(() => socket().emit({ kind: 'entity:changed', entityType: 'endpoint', slug: 'get-users', action: 'update' }));
    // Batched: nothing before the 500 ms window closes.
    await settle(499);
    expect(calls.detail).toBe(1);
    await settle(1);
    await flushQueryNotifications();

    expect(calls.detail).toBe(2);
    expect(host.textContent).toBe('After');
    // The type's list follows too.
    expect(calls.list).toBe(2);
    // Same mounted tree and socket — no remount / page reload happened.
    expect(FakeSocket.instances.length).toBe(sockets);
    // Version history and keys outside the host convention are not refreshed.
    expect(calls.versions).toBe(1);
    expect(calls.other).toBe(1);
  });

  it('[ac:ac-zmiana-encji-zapisana-z-zewnatrz-agen] entity:indexed (external edit of the entity file) refreshes the open detail the same way', async () => {
    await mount();
    stored = { slug: 'get-users', title: 'Edited on disk' };
    act(() => socket().emit({ kind: 'entity:indexed', type: 'endpoint', slug: 'get-users' }));
    await settle(500);
    await flushQueryNotifications();

    expect(calls.detail).toBe(2);
    expect(host.textContent).toBe('Edited on disk');
    expect(calls.versions).toBe(1);
  });

  it('a change of another entity leaves the open detail alone', async () => {
    await mount();
    act(() => socket().emit({ kind: 'entity:changed', entityType: 'endpoint', slug: 'post-users', action: 'update' }));
    await settle(500);
    await flushQueryNotifications();
    expect(calls.detail).toBe(1);
    expect(calls.list).toBe(2);
  });

  it('the host map is list, detail and aggregate keys — versions are not on it', () => {
    expect(entityChangeKeys('endpoint', 'get-users')).toEqual([
      ['endpoints'],
      ['endpoint', 'get-users'],
      ['entities'],
    ]);
    // Unknown type (before plugin boot settles): list falls back to the aggregate key.
    expect(entityChangeKeys('nope', 'x')[0]).toEqual(['entities']);
  });
});
