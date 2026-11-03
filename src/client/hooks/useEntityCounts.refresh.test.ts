// @vitest-environment happy-dom
/**
 * 2.1.65 (M13 `m13ui000` "Stan — Zapytania") — the entity counters are ONE map
 * from `GET /api/entities/counts`; the host shows, beside each type entry, the
 * number this map holds for it. The map refreshes WHOLE after every entity
 * change, index change, tag change and plugin reload; there is no refresh of a
 * single type's counter.
 *
 * The host's real global observer (`useFileWatcher`) and the real
 * `useEntityCounts` run here; the server is a stubbed `apiFetch` counting the
 * aggregate's requests, and the WS is a test double the test plays events into.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const server = vi.hoisted(() => ({ counts: { endpoint: 1, dto: 2 } as Record<string, number>, requests: [] as string[] }));

vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: {
    getAvailable: (type: string) =>
      type === 'endpoint' ? { type, pathPrefix: '/endpoints' } : type === 'dto' ? { type, pathPrefix: '/dtos' } : undefined,
    listEntities: () => [{ type: 'endpoint' }, { type: 'dto' }],
  },
}));
vi.mock('../lib/api-core.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api-core.js')>();
  return {
    ...real,
    apiFetch: async (url: string) => {
      server.requests.push(url);
      return new Response(JSON.stringify({ counts: { ...server.counts } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
});

import { useFileWatcher } from './useFileWatcher.js';
import { ENTITY_COUNTS_KEY, useEntityCounts } from './useEntityCounts.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** The sidebar ELEMENTS badges: one number per type entry, read off the one map. */
function Badges() {
  useFileWatcher();
  const { data } = useEntityCounts();
  return createElement(
    'ul',
    null,
    ...['endpoint', 'dto'].map((type) => createElement('li', { key: type, 'data-type': type }, String(data?.[type] ?? '…'))),
  );
}

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Badges)));
  });
  await settle();
  await settle(1);
}

const socket = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;
const badge = (type: string) => host.querySelector(`[data-type="${type}"]`)?.textContent;
const countRequests = () => server.requests.filter((u) => u === '/api/entities/counts').length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  server.counts = { endpoint: 1, dto: 2 };
  server.requests = [];
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

describe('[section:m13ui000] the entity counters are one map, refreshed whole', () => {
  it('[section:m13ui000] each type entry shows the number the one map from GET /api/entities/counts holds for it', async () => {
    await mount();
    expect(countRequests()).toBe(1);
    expect(badge('endpoint')).toBe('1');
    expect(badge('dto')).toBe('2');
    // One query for the counters — the whole map — and no per-type counter query.
    const countQueries = qc.getQueryCache().findAll({ predicate: (q) => JSON.stringify(q.queryKey).includes('counts') });
    expect(countQueries.map((q) => q.queryKey)).toEqual([[...ENTITY_COUNTS_KEY]]);
  });

  const events: Array<[string, unknown]> = [
    ['an entity change', { kind: 'entity:changed', entityType: 'endpoint', slug: 'get-users', action: 'update' }],
    ['an index change', { kind: 'entity:indexed', type: 'dto', slug: 'user-dto' }],
    ['a tag change', { kind: 'tag:changed', slug: 'billing', action: 'update' }],
    ['a plugin reload', { kind: 'plugin:reloaded', name: '@acme/c4s-plugin-glossary', version: '1.0.0', tier: 'base' }],
  ];

  for (const [label, event] of events) {
    it(`[section:m13ui000] after ${label} the whole map is refetched — every type's number moves, not only the one named`, async () => {
      await mount();
      expect(countRequests()).toBe(1);

      server.counts = { endpoint: 5, dto: 7 };
      act(() => socket().emit(event));
      await settle(500);
      await settle(1);
      await settle(1);

      expect(countRequests()).toBe(2);
      expect(badge('endpoint')).toBe('5');
      expect(badge('dto')).toBe('7');
    });
  }
});
