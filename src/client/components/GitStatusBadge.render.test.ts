// @vitest-environment happy-dom
/**
 * 2.1.10 (M28 846dmtbu, 8i5qf0xx) — the header branch switcher: Fetch action
 * and `Sync ↓N` with their visibility rules, spinner and lock while an
 * operation runs, results as toasts and hints, the route reload after a sync
 * that moved HEAD (its toast carried across the reload), and "Last fetched …"
 * in the entry tooltip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitStatusResponse } from '../../shared/git.js';

const reload = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/project-reload.js', () => ({
  reloadProjectRoute: () => {
    reload.calls += 1;
  },
}));
vi.mock('../hooks/useConfig.js', () => ({ useConfig: () => ({ data: { git: { enabled: true } } }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {} }));

import { GitStatusBadge } from './GitStatusBadge.js';
import { setGitFlashToast, takeGitFlashToast } from '../lib/git-flash.js';
import { useGitOpsStore } from '../state/gitOps.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse('2026-10-09T12:00:00.000Z');

const baseStatus: GitStatusResponse = {
  detected: true,
  rootPath: '/repo',
  remoteUrl: 'git@example.com:spec.git',
  branch: 'main',
  isDirty: false,
  ahead: 1,
  behind: 3,
  lastFetchedAt: '2026-10-09T11:55:00.000Z',
};

let host: HTMLDivElement;
let root: Root;
let status: GitStatusResponse;
let routes: Record<string, () => Promise<unknown>>;
let toasts: Array<{ variant: string; message: string }>;
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(GitStatusBadge)));
  });
  await settle();
}

const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.click();
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  reload.calls = 0;
  toasts = [];
  status = { ...baseStatus };
  useGitOpsStore.setState({ ops: [] });
  window.sessionStorage.clear();
  routes = {
    '/api/git/status': async () => status,
    '/api/git/branches': async () => ({ current: 'main', branches: ['main', 'feature'] }),
    // 2.1.46: the open dropdown also reads the shadow list (its own tests: GitStatusBadge.shadows.render.test.ts).
    '/api/git/shadows': async () => ({ shadows: [] }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
      const route = routes[path];
      if (!route) throw new Error(`unexpected request ${path}`);
      return json(await route());
    }),
  );
  window.addEventListener('c4s:toast', onToast);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener('c4s:toast', onToast);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('header branch switcher — Fetch and Sync', () => {
  it('shows the Fetch action with an upstream and `Sync ↓N` only when behind > 0', async () => {
    await mount();
    expect(q('[data-git-fetch]')).not.toBeNull();
    expect(q('[data-git-sync]')?.textContent).toContain('Sync ↓3');
    await act(async () => root.unmount());

    root = createRoot(host);
    status = { ...baseStatus, behind: 0 };
    await mount();
    expect(q('[data-git-fetch]')).not.toBeNull();
    expect(q('[data-git-sync]')).toBeNull();
    await act(async () => root.unmount());

    root = createRoot(host);
    status = { ...baseStatus, ahead: null, behind: null };
    await mount();
    expect(q('[data-git-fetch]')).toBeNull();
    expect(q('[data-git-sync]')).toBeNull();
  });

  it('the entry tooltip carries the full counts and "Last fetched …"; no such line when lastFetchedAt is null', async () => {
    await mount();
    const title = q('[data-git-entry-toggle]')?.getAttribute('title') ?? '';
    expect(title).toContain('1 commit ahead / 3 commits behind upstream');
    expect(title).toContain('Last fetched 5 minutes ago');
    await act(async () => root.unmount());

    root = createRoot(host);
    status = { ...baseStatus, lastFetchedAt: null };
    await mount();
    expect(q('[data-git-entry-toggle]')?.getAttribute('title') ?? '').not.toContain('Last fetched');
  });

  it('while a fetch runs the entry spins and both actions are locked; the result is a toast', async () => {
    const pending = deferred<unknown>();
    routes['/api/git/fetch'] = () => pending.promise;
    await mount();

    await click(q('[data-git-fetch]'));
    expect(q('[data-git-spinner]')).not.toBeNull();
    expect((q('[data-git-fetch]') as HTMLButtonElement).disabled).toBe(true);
    expect((q('[data-git-sync]') as HTMLButtonElement).disabled).toBe(true);

    pending.resolve({ status: 'fetched', ahead: 1, behind: 3, message: null });
    await settle();
    expect(q('[data-git-spinner]')).toBeNull();
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: '3 new commits on the remote' }));
  });

  it('while a sync runs the branch list is locked', async () => {
    const pending = deferred<unknown>();
    routes['/api/git/sync'] = () => pending.promise;
    await mount();
    await click(q('[data-git-entry-toggle]'));
    await settle();
    const feature = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'feature',
    );
    expect(feature?.disabled).toBe(false);

    await click(q('[data-git-sync]'));
    expect(feature?.disabled).toBe(true);
    pending.resolve({ status: 'up-to-date', paths: null, reason: null, message: null });
    await settle();
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Already up to date' }));
  });

  it('a sync that fast-forwarded reloads the project route and carries "Updated from the remote" across it', async () => {
    routes['/api/git/sync'] = async () => ({ status: 'fast-forwarded', paths: null, reason: null, message: null });
    await mount();
    await click(q('[data-git-sync]'));
    await settle();

    expect(reload.calls).toBe(1);
    expect(toasts).toEqual([]);
    expect(takeGitFlashToast()).toEqual({ variant: 'success', message: 'Updated from the remote' });
  });

  it('after the reload the parked toast is shown once', async () => {
    setGitFlashToast({ variant: 'success', message: 'Updated from the remote' });
    await mount();
    await settle(1);
    expect(toasts).toEqual([{ variant: 'success', message: 'Updated from the remote' }]);
    expect(takeGitFlashToast()).toBeNull();
  });

  it('sync dirty-blocked is a warning toast with the file count; busy is a hint at the entry', async () => {
    routes['/api/git/sync'] = async () => ({
      status: 'dirty-blocked',
      paths: ['pages/a.md', 'pages/b.md'],
      reason: null,
      message: null,
    });
    await mount();
    await click(q('[data-git-sync]'));
    await settle();
    expect(toasts).toContainEqual(
      expect.objectContaining({ variant: 'warning', message: 'Commit your local changes to 2 files before syncing' }),
    );
    expect(reload.calls).toBe(0);

    routes['/api/git/fetch'] = async () => ({ status: 'busy', ahead: null, behind: null, message: null });
    await click(q('[data-git-fetch]'));
    await settle();
    expect(q('[data-git-entry-hint]')?.textContent).toBe('A background task is running — try again in a moment');
  });
});

/**
 * 2.1.49 (endpoints get-api-git-branches / post-api-git-checkout) — the
 * interactive branch switcher: the dropdown lists the local branches from
 * `GET /api/git/branches` with the current one marked, a checkout spins the
 * entry, and every non-`switched` outcome is an English inline hint or toast.
 */
describe('header branch switcher — branch list and checkout', () => {
  const branchButton = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name) ?? null;
  const checkoutBodies = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/git/checkout'))
      .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? 'null')));

  async function openList() {
    await click(q('[data-git-entry-toggle]'));
    await settle();
  }

  it('[ac:ac-interaktywny-gitstatusbadge-po-kliknie] a click opens the local branches with `current` marked; a checkout spins the entry; dirty-blocked / not-found / busy / error come back as English hints and toasts', async () => {
    await mount();
    expect(branchButton('main')).toBeNull(); // closed until clicked
    await openList();

    // The local branches, the current one marked (accent + bold) and not pickable.
    const main = branchButton('main');
    const feature = branchButton('feature');
    expect(main).not.toBeNull();
    expect(feature).not.toBeNull();
    expect(main!.disabled).toBe(true);
    expect(main!.style.fontWeight).toBe('600');
    expect(feature!.disabled).toBe(false);
    expect(feature!.style.fontWeight).toBe('400');

    // Spinner while the checkout runs; the list is locked.
    const pending = deferred<unknown>();
    routes['/api/git/checkout'] = () => pending.promise;
    expect(q('[data-git-spinner]')).toBeNull();
    await click(feature);
    expect(q('[data-git-spinner]')).not.toBeNull();
    expect(branchButton('feature')!.disabled).toBe(true);
    expect(checkoutBodies()).toEqual([{ branch: 'feature' }]);

    // dirty-blocked → an inline hint in the open list.
    pending.resolve({ status: 'dirty-blocked', branch: null, message: 'pages/a.md is modified' });
    await settle();
    expect(q('[data-git-spinner]')).toBeNull();
    expect(q('[data-git-list-hint]')?.textContent).toBe('Commit or stash your changes before switching branches');
    expect(reload.calls).toBe(0);

    // not-found → a warning toast, the list closes.
    routes['/api/git/checkout'] = async () => ({ status: 'not-found', branch: null, message: 'no such branch' });
    await click(branchButton('feature'));
    await settle();
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'warning', message: 'Branch no longer exists' }));
    expect(branchButton('feature')).toBeNull();

    // busy → an inline hint at the entry.
    routes['/api/git/checkout'] = async () => ({ status: 'busy', branch: null, message: null });
    await openList();
    await click(branchButton('feature'));
    await settle();
    expect(q('[data-git-entry-hint]')?.textContent).toBe('A background task is running — try again in a moment');

    // error → an error toast carrying git's message, the list closes (busy left it open).
    routes['/api/git/checkout'] = async () => ({
      status: 'error',
      branch: null,
      message: 'untracked working tree files would be overwritten by checkout',
    });
    expect(branchButton('feature')).not.toBeNull();
    await click(branchButton('feature'));
    await settle();
    expect(toasts).toContainEqual(
      expect.objectContaining({ variant: 'error', message: 'untracked working tree files would be overwritten by checkout' }),
    );
    expect(branchButton('feature')).toBeNull();
    expect(reload.calls).toBe(0);
  });

  it('[ac:ac-w-detached-head-gitstatusbadge-pokazuj] on a detached HEAD the badge still opens the branch list (current null, branches non-empty) and a pick checks the branch out', async () => {
    status = { ...baseStatus, branch: null, ahead: null, behind: null };
    routes['/api/git/branches'] = async () => ({ current: null, branches: ['main', 'feature'] });
    routes['/api/git/checkout'] = async () => ({ status: 'switched', branch: 'main', message: null });
    await mount();

    expect(q('[data-git-entry-toggle]')?.textContent).toContain('detached HEAD');
    await openList();

    // Not a read-only fallback: every branch is listed and pickable, none is current.
    const main = branchButton('main');
    const feature = branchButton('feature');
    expect(main).not.toBeNull();
    expect(feature).not.toBeNull();
    expect(main!.disabled).toBe(false);
    expect(feature!.disabled).toBe(false);
    expect(host.textContent).not.toContain('No local branches');

    await click(main);
    await settle();
    expect(checkoutBodies()).toEqual([{ branch: 'main' }]);
    expect(reload.calls).toBe(1); // switched → the project route reloads
  });
});
