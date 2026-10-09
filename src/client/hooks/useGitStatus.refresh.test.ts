// @vitest-environment happy-dom
/**
 * 2.1.10 (M28 8i5qf0xx "Stan", M31 ic35jwy6) — the client keeps the git status
 * fresh: the WS map `git:status-changed` → `["git-status"]` (through the real
 * `useFileWatcher` socket handler), a refetch when the window regains focus,
 * and a project route reload when ANOTHER client's operation moved HEAD.
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
// The watcher's plugin branches are not exercised here; keep their runtimes out.
vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getAvailable: () => undefined, listEntities: () => [] },
}));

import { useFileWatcher } from './useFileWatcher.js';
import { useGitStatus } from './useGitStatus.js';
import { useGitOpsStore } from '../state/gitOps.js';
import { takeGitFlashToast } from '../lib/git-flash.js';

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

const STATUS = {
  detected: true,
  rootPath: '/repo',
  remoteUrl: null,
  branch: 'main',
  isDirty: false,
  ahead: 0,
  behind: 0,
  lastFetchedAt: null,
};

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const statusCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/git/status')).length;

function Probe(props: { watch: boolean }) {
  if (props.watch) useFileWatcher();
  useGitStatus({ enabled: true });
  return null;
}

async function mount(watch: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe, { watch })));
  });
  await settle();
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  reload.calls = 0;
  useGitOpsStore.setState({ pending: null });
  window.sessionStorage.clear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(STATUS), { status: 200 }));
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

describe('git status refresh — WS event', () => {
  it('[ac:ac-klient-po-odebraniu-git-status-change] git:status-changed makes the client fetch GET /api/git/status again', async () => {
    await mount(true);
    expect(statusCalls()).toBe(1);
    expect(FakeSocket.last).not.toBeNull();

    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: false }));
    // The watcher batches invalidations in a 500 ms window.
    await settle(500);
    await settle();

    expect(statusCalls()).toBe(2);
    // A ref-only change (fetch) does not reload the route.
    expect(reload.calls).toBe(0);
  });

  it('[ac:ac-klient-ktory-nie-inicjowal-operacji-p] a client that did not start the operation reloads the project route on git:status-changed with headChanged: true', async () => {
    await mount(true);
    expect(useGitOpsStore.getState().pending).toBeNull();

    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: true }));
    expect(reload.calls).toBe(1);
  });

  it('the client whose own sync moved HEAD leaves the reload to its response and parks "Updated from the remote" across it', async () => {
    await mount(true);
    useGitOpsStore.getState().begin('sync');

    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: true }));
    expect(reload.calls).toBe(0);
    expect(takeGitFlashToast()).toEqual({ variant: 'success', message: 'Updated from the remote' });
  });

  it('the client whose own checkout moved HEAD does not reload on the event either', async () => {
    await mount(true);
    useGitOpsStore.getState().begin('checkout');

    act(() => FakeSocket.last!.emit({ kind: 'git:status-changed', headChanged: true }));
    expect(reload.calls).toBe(0);
    expect(takeGitFlashToast()).toBeNull();
  });
});

describe('git status refresh — window focus', () => {
  it('[ac:ac-klient-po-powrocie-fokusu-okna-pobier] the window regaining focus makes the client fetch GET /api/git/status again', async () => {
    await mount(false);
    expect(statusCalls()).toBe(1);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(statusCalls()).toBe(2);

    // The page becoming visible again (tab switch) is a focus return too.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(statusCalls()).toBe(3);
  });
});
