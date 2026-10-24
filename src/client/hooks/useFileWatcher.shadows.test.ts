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

vi.mock('../lib/project-reload.js', () => ({ reloadProjectRoute: () => {} }));
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
  useGitOpsStore.setState({ pending: null });
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
