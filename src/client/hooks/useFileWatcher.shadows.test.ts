// @vitest-environment happy-dom
/**
 * 2.1.46 — the WS maps "event → query key" for the shadows, through the real
 * `useFileWatcher` socket handler:
 *
 * - M28 8i5qf0xx "Stan": `git:status-changed` invalidates `["git-status"]` AND
 *   `["git-shadows"]` (an accepted shadow leaves the list after the release
 *   commit, a deleted one after a Fetch);
 * - M17 m17ui001 "Stan": `git:status-changed` invalidates `['shadow-diff']`,
 *   the Shadows tab's delta. A content event (an entity edit) does not — the
 *   shadow comparison reads git states, not the working tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const reload = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/project-reload.js', () => ({
  reloadProjectRoute: () => {
    reload.calls += 1;
  },
}));
vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getAvailable: () => undefined, listEntities: () => [] },
}));

import { useFileWatcher } from './useFileWatcher.js';
import { useGitShadows } from './useGitShadows.js';
import { useShadowDiff } from './useReleases.js';
import { useGitOpsStore } from '../state/gitOps.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal WebSocket double: the test plays server events through `emit`. */
class FakeSocket {
  static last: FakeSocket | null = null;
  static created = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
    FakeSocket.created += 1;
  }
  close() {}
  open() {
    this.onopen?.();
  }
  drop() {
    this.onclose?.();
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (suffix: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
const shadowListCalls = () => calls('/api/git/shadows');
const shadowDiffCalls = () => calls('/api/shadow-diff?ref=run-1%2Fspec');

function Probe() {
  useFileWatcher();
  useGitShadows();
  useShadowDiff('run-1/spec');
  return null;
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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
  useGitOpsStore.setState({ ops: [] });
  reload.calls = 0;
  FakeSocket.created = 0;
  fetchMock = vi.fn(async (url: string) => {
    const body = String(url).endsWith('/api/git/shadows') ? { shadows: [] } : { mode: 'merge', entities: [], pages: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeSocket);
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.last = null;
});

describe('shadow queries — WS invalidation', () => {
  it('[section:8i5qf0xx] [section:846dmtbu] git:status-changed makes the client fetch GET /api/git/shadows again', async () => {
    await mount();
    expect(shadowListCalls()).toBe(1);

    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: false }));
    // The watcher batches invalidations in a 500 ms window.
    await settle(500);
    await settle();
    expect(shadowListCalls()).toBe(2);
  });

  it("[section:m17ui001] git:status-changed refetches the Shadows tab's delta ['shadow-diff', <ref>]; an entity change does not", async () => {
    await mount();
    expect(shadowDiffCalls()).toBe(1);

    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: false }));
    await settle(500);
    await settle();
    expect(shadowDiffCalls()).toBe(2);

    act(() => FakeSocket.last!.emit({ kind: 'entity:changed', entityType: 'endpoint', slug: 'e1', action: 'updated' }));
    await settle(500);
    await settle();
    expect(shadowDiffCalls()).toBe(2);
    expect(shadowListCalls()).toBe(2);
  });
});

describe('own git operations — live-update socket reconnect', () => {
  it('[section:8i5qf0xx] [section:m17ui001] a reconnect of the live-update socket drops an answered-but-unclaimed own operation (its frame was lost while the socket was down), so the next HEAD move of another client reloads; an operation still in flight keeps its mark', async () => {
    await mount();
    act(() => FakeSocket.last!.open());
    // An acceptance answered "release commit landed", its HEAD frame not yet seen;
    // a Sync is still in flight.
    act(() =>
      useGitOpsStore.setState({
        ops: [
          { op: 'accept', headSeen: false, answered: true },
          { op: 'sync', headSeen: false, answered: false },
        ],
      }),
    );

    // The socket drops — the frame broadcast meanwhile is gone — and reconnects after 1 s.
    act(() => FakeSocket.last!.drop());
    await settle(1000);
    expect(FakeSocket.created).toBe(2);
    // The first open of the new socket is a reconnect: answered entries go, in-flight ones stay.
    expect(useGitOpsStore.getState().ops).toHaveLength(2);
    act(() => FakeSocket.last!.open());
    expect(useGitOpsStore.getState().ops).toEqual([{ op: 'sync', headSeen: false, answered: false }]);

    // The Sync's own HEAD event is still attributed to it (no reload) …
    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: true }));
    expect(reload.calls).toBe(0);
    // … and the dropped acceptance no longer swallows another client's HEAD move.
    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: true }));
    expect(reload.calls).toBe(1);
  });

  it('[section:8i5qf0xx] the first open of the live-update socket is not a reconnect: an answered own operation keeps its mark', async () => {
    act(() => useGitOpsStore.setState({ ops: [{ op: 'accept', headSeen: false, answered: true }] }));
    await mount();
    act(() => FakeSocket.last!.open());
    expect(useGitOpsStore.getState().ops).toEqual([{ op: 'accept', headSeen: false, answered: true }]);
  });
});
