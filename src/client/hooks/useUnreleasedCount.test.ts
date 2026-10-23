// @vitest-environment happy-dom
/**
 * 2.1.45 (M17 L2 zbc9jdnr, L5 m17ui001 "Stan") — the unreleased counter is ONE
 * shared frontend query, `['release-diff', <newest release>, 'current',
 * { summaryOnly: true }]`, whose value is changed entities + changed pages of
 * the light `release_diff` newest → current; and it is refreshed by the same
 * WS events (and the same `['release-diff']` invalidation) as the Compare tab.
 * Content events reach only the diffs against `current`; a frozen
 * release → release diff is refetched by release lifecycle events alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The watcher's plugin branches are not exercised here; keep their runtimes out.
vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getAvailable: () => undefined, listEntities: () => [] },
}));
vi.mock('../lib/project-reload.js', () => ({ reloadProjectRoute: () => {} }));

import { useFileWatcher } from './useFileWatcher.js';
import { unreleasedCounterKey, useReleaseDiff, useUnreleasedCount } from './useReleases.js';
import { RELEASE_DIFF_CONTENT_EVENTS, RELEASE_DIFF_LIFECYCLE_EVENTS } from '../lib/release-diff-invalidation.js';

/** The whole M17 WS map: content events + release lifecycle events. */
const RELEASE_DIFF_INVALIDATING_EVENTS = [...RELEASE_DIFF_CONTENT_EVENTS, ...RELEASE_DIFF_LIFECYCLE_EVENTS] as const;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal WebSocket double: the test plays server events through `emit`. */
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

const release = (id: number, name: string) => ({
  id,
  name,
  slug: name,
  description: `desc ${name}`,
  createdBy: 'user',
  createdAt: `2026-10-0${id}T10:00:00.000Z`,
});

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
/** Newest first, as `GET /api/releases` answers. */
let releaseList: ReturnType<typeof release>[];
const SUMMARY = { from: { id: 2, name: 'v2' }, to: { id: null, name: 'current' }, total: { entities: 3, pages: 2 }, entities: [], pages: [] };
const RAW_DIFF = { from: { id: 1, name: 'v1' }, to: { id: 0, name: 'current' }, entities: [], pages: [] };

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
const counterCalls = () => urls().filter((u) => u.includes('/diff/current?view=operation&summaryOnly=true'));
const compareCalls = () => urls().filter((u) => u.endsWith('/api/releases/v1/diff/current'));
const pairCalls = () => urls().filter((u) => u.endsWith('/api/releases/v1/diff/v2'));

let counterValue: number | undefined;

type ProbeProps = { watch: boolean; compare: boolean; pair?: boolean };

function Probe(props: ProbeProps) {
  if (props.watch) useFileWatcher();
  counterValue = useUnreleasedCount().data;
  // The Compare tab's own diff query (`['release-diff', <from>, 'current']`).
  useReleaseDiff(props.compare ? 'v1' : undefined, props.compare ? 'current' : undefined);
  // A frozen release → release diff (`['release-diff', 'v1', 'v2']`).
  useReleaseDiff(props.pair ? 'v1' : undefined, props.pair ? 'v2' : undefined);
  return null;
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(props: ProbeProps) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe, props)));
  });
  // releases → counter (dependent query) → settled.
  await settle();
  await settle();
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  releaseList = [release(2, 'v2'), release(1, 'v1')];
  counterValue = undefined;
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/api/releases')) return new Response(JSON.stringify({ releases: releaseList }), { status: 200 });
    if (url.includes('/diff/current?view=operation&summaryOnly=true')) {
      return new Response(JSON.stringify({ data: SUMMARY }), { status: 200 });
    }
    if (url.endsWith('/diff/current')) return new Response(JSON.stringify(RAW_DIFF), { status: 200 });
    if (url.endsWith('/diff/v2')) return new Response(JSON.stringify(RAW_DIFF), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeSocket);
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  qc.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.last = null;
});

describe('unreleased counter — the shared query', () => {
  it('[ac:ac-licznik-niezreleasowanych-zmian-rowna] the counter is changed entities + changed pages of the light release_diff from the NEWEST release to current', async () => {
    await mount({ watch: false, compare: false });

    // One light-delta request, against the head of the newest-first list.
    expect(counterCalls()).toEqual(['/api/releases/v2/diff/current?view=operation&summaryOnly=true']);
    // total.entities (3) + total.pages (2).
    expect(counterValue).toBe(5);
    // It lives under the shared key, prefixed like the Compare tab's diff.
    expect(qc.getQueryData(unreleasedCounterKey('v2'))).toBe(5);
    expect(unreleasedCounterKey('v2')).toEqual(['release-diff', 'v2', 'current', { summaryOnly: true }]);
    // No second source: the old per-version count endpoint is never asked.
    expect(urls().some((u) => u.includes('unreleased-count'))).toBe(false);
  });

  it('without any release the counter does not exist — no delta request, no value', async () => {
    releaseList = [];
    await mount({ watch: false, compare: false });

    expect(counterCalls()).toEqual([]);
    expect(counterValue).toBeUndefined();
  });
});

describe('unreleased counter — refreshed by the Compare tab events', () => {
  it('[section:m17ui001] every event of the M17 WS map refetches both the counter and the Compare tab diff', async () => {
    await mount({ watch: true, compare: true });
    expect(FakeSocket.last).not.toBeNull();

    const samples: Record<(typeof RELEASE_DIFF_INVALIDATING_EVENTS)[number], unknown> = {
      'file:changed': { kind: 'file:changed', event: 'change', path: 'a.md', rootId: 'pages', origin: 'server' },
      'entity:changed': { kind: 'entity:changed', entityType: 'endpoint', slug: 'e1', action: 'updated' },
      'tag:changed': { kind: 'tag:changed', slug: 't1', action: 'updated' },
      'page:renamed': { kind: 'page:renamed', from: 'a.md', to: 'b.md' },
      'pages:frontmatter-changed': { kind: 'pages:frontmatter-changed', path: 'a.md', rootId: 'pages' },
      'release:created': { kind: 'release:created', releaseId: 3, name: 'v3' },
      'release:updated': { kind: 'release:updated', releaseId: 2, name: 'v2' },
      'git:status-changed': { kind: 'git:status-changed', headChanged: false },
    };
    expect(Object.keys(samples).sort()).toEqual([...RELEASE_DIFF_INVALIDATING_EVENTS].sort());

    for (const kind of RELEASE_DIFF_INVALIDATING_EVENTS) {
      const counterBefore = counterCalls().length;
      const compareBefore = compareCalls().length;
      act(() => FakeSocket.last!.emit(samples[kind]));
      // The watcher batches invalidations in a 500 ms window.
      await settle(500);
      await settle();
      expect({ kind, counter: counterCalls().length }).toEqual({ kind, counter: counterBefore + 1 });
      expect({ kind, compare: compareCalls().length }).toEqual({ kind, compare: compareBefore + 1 });
    }
  });

  it('a content event refetches only the diffs against current — a release → release diff stays cached; a release lifecycle event refetches it', async () => {
    await mount({ watch: true, compare: true, pair: true });
    expect(pairCalls()).toHaveLength(1);

    const samples: Record<(typeof RELEASE_DIFF_CONTENT_EVENTS)[number], unknown> = {
      'file:changed': { kind: 'file:changed', event: 'change', path: 'a.md', rootId: 'pages', origin: 'server' },
      'entity:changed': { kind: 'entity:changed', entityType: 'endpoint', slug: 'e1', action: 'updated' },
      'tag:changed': { kind: 'tag:changed', slug: 't1', action: 'updated' },
      'page:renamed': { kind: 'page:renamed', from: 'a.md', to: 'b.md' },
      'pages:frontmatter-changed': { kind: 'pages:frontmatter-changed', path: 'a.md', rootId: 'pages' },
      'git:status-changed': { kind: 'git:status-changed', headChanged: false },
    };
    expect(Object.keys(samples).sort()).toEqual([...RELEASE_DIFF_CONTENT_EVENTS].sort());

    for (const kind of RELEASE_DIFF_CONTENT_EVENTS) {
      const counterBefore = counterCalls().length;
      const compareBefore = compareCalls().length;
      act(() => FakeSocket.last!.emit(samples[kind]));
      await settle(500);
      await settle();
      expect({ kind, counter: counterCalls().length }).toEqual({ kind, counter: counterBefore + 1 });
      expect({ kind, compare: compareCalls().length }).toEqual({ kind, compare: compareBefore + 1 });
      expect({ kind, pair: pairCalls().length }).toEqual({ kind, pair: 1 });
      expect({ kind, invalidated: qc.getQueryState(['release-diff', 'v1', 'v2'])?.isInvalidated }).toEqual({
        kind,
        invalidated: false,
      });
    }

    for (const kind of RELEASE_DIFF_LIFECYCLE_EVENTS) {
      const pairBefore = pairCalls().length;
      act(() => FakeSocket.last!.emit({ kind, releaseId: 2, name: 'v2' }));
      await settle(500);
      await settle();
      expect({ kind, pair: pairCalls().length }).toEqual({ kind, pair: pairBefore + 1 });
    }
  });

  it('a lifecycle and content events in one batch window refetch the counter and the Compare diff once each', async () => {
    await mount({ watch: true, compare: true });
    const counterBefore = counterCalls().length;
    const compareBefore = compareCalls().length;

    // Creating a release: its lifecycle event, its record file, a git status change.
    act(() => {
      FakeSocket.last!.emit({ kind: 'release:created', releaseId: 3, name: 'v3' });
      FakeSocket.last!.emit({ kind: 'file:changed', event: 'add', path: 'v3.json', rootId: 'releases', origin: 'server' });
      FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: false });
      FakeSocket.last!.emit({ kind: 'file:changed', event: 'change', path: 'a.md', rootId: 'pages', origin: 'server' });
    });
    await settle(500);
    await settle();
    await settle();

    expect(counterCalls().length).toBe(counterBefore + 1);
    expect(compareCalls().length).toBe(compareBefore + 1);
  });

  it('a file change in a system root without a facade (briefs) leaves the counter and the Compare diff alone', async () => {
    await mount({ watch: true, compare: true });
    const counterBefore = counterCalls().length;
    const compareBefore = compareCalls().length;

    act(() =>
      FakeSocket.last!.emit({ kind: 'file:changed', event: 'change', path: 'b1.md', rootId: 'briefs', origin: 'server' }),
    );
    await settle(500);
    await settle();

    expect(counterCalls().length).toBe(counterBefore);
    expect(compareCalls().length).toBe(compareBefore);
    expect(qc.getQueryState(['release-diff', 'v1', 'current'])?.isInvalidated).toBe(false);
  });

  it('an event outside the map leaves the counter alone', async () => {
    await mount({ watch: true, compare: false });
    const before = counterCalls().length;

    act(() => FakeSocket.last!.emit({ kind: 'todos:changed' }));
    await settle(500);
    await settle();

    expect(counterCalls().length).toBe(before);
  });
});
