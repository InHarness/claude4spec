// @vitest-environment happy-dom
/**
 * 2.1.46 (M28 8i5qf0xx / 846dmtbu) — the header branch switcher's dropdown has
 * two sections: „Branches” and, with git on and a non-empty shadow list
 * (`GET /api/git/shadows`), „Shadows” — set apart, never current, each item
 * its id and the tip commit's time, the subject in the tooltip. Picking a
 * shadow only navigates to `/releases?tab=shadow&ref=<id>`: no checkout, no
 * guard, no lock, HEAD untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitShadow, GitStatusResponse } from '../../shared/git.js';

const cfg = vi.hoisted(() => ({ gitEnabled: true }));
const nav = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../lib/project-reload.js', () => ({ reloadProjectRoute: () => {} }));
vi.mock('../hooks/useConfig.js', () => ({ useConfig: () => ({ data: { git: { enabled: cfg.gitEnabled } } }) }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (opts: unknown) => {
    nav.calls.push(opts);
  },
}));

import { GitStatusBadge } from './GitStatusBadge.js';
import { useGitOpsStore } from '../state/gitOps.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse('2026-10-23T12:00:00.000Z');

const STATUS: GitStatusResponse = {
  detected: true,
  rootPath: '/repo',
  remoteUrl: 'git@example.com:spec.git',
  branch: 'main',
  isDirty: true,
  ahead: 0,
  behind: 0,
  lastFetchedAt: null,
};

const SHADOW: GitShadow = {
  id: 'run-1/spec',
  tipSha: 'bbbbbbb2222222222222222222222222222222',
  tipCommittedAt: '2026-10-23T11:55:00.000Z',
  tipSubject: 'Spec run 1: new endpoints',
};

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;
let shadows: GitShadow[];
let fetchMock: ReturnType<typeof vi.fn>;

const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: String(url).replace(/^\/api\/projects\/[^/]+/, '/api'),
    method: ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
  }));

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount() {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(GitStatusBadge)));
  });
  await settle();
}

async function openDropdown() {
  const toggle = host.querySelector<HTMLElement>('[data-git-entry-toggle]');
  expect(toggle).not.toBeNull();
  await act(async () => {
    toggle!.click();
  });
  await settle();
}

const shadowSection = () => document.body.querySelector<HTMLElement>('[data-git-shadows]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  cfg.gitEnabled = true;
  nav.calls = [];
  shadows = [SHADOW];
  useGitOpsStore.setState({ ops: [] });
  window.sessionStorage.clear();
  fetchMock = vi.fn(async (url: string) => {
    const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
    if (path === '/api/git/status') return new Response(JSON.stringify(STATUS), { status: 200 });
    if (path === '/api/git/branches') {
      return new Response(JSON.stringify({ current: 'main', branches: ['main', 'feature'] }), { status: 200 });
    }
    if (path === '/api/git/shadows') return new Response(JSON.stringify({ shadows }), { status: 200 });
    throw new Error(`unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
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
});

describe('header branch switcher — Shadows section', () => {
  it('[section:8i5qf0xx] [section:846dmtbu] the dropdown has a "Branches" and a "Shadows" section; a shadow item shows its id and the tip time, its subject in the tooltip, and is never current', async () => {
    await mount();
    // The list is read only while the dropdown is open.
    expect(requests().map((r) => r.path)).not.toContain('/api/git/shadows');

    await openDropdown();
    expect(requests().map((r) => r.path)).toContain('/api/git/shadows');
    expect(document.body.textContent).toContain('Branches');
    const section = shadowSection()!;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain('Shadows');
    const item = section.querySelector<HTMLButtonElement>(`[data-git-shadow="${SHADOW.id}"]`)!;
    expect(item.textContent).toContain('run-1/spec');
    expect(item.textContent).toContain('5 minutes ago');
    expect(item.getAttribute('title')).toBe('Spec run 1: new endpoints');
    // Never current, never locked: the dirty tree does not disable it either.
    expect(item.disabled).toBe(false);

    // An empty shadow list → no Shadows section.
    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    shadows = [];
    await mount();
    await openDropdown();
    expect(document.body.textContent).toContain('feature');
    expect(shadowSection()).toBeNull();
  });

  it('[ac:ac-przy-config-git-enabled-false-sekcji] with config.git.enabled = false there is no Shadows section in the sidebar header', async () => {
    cfg.gitEnabled = false;
    await mount();

    expect(host.querySelector('[data-git-entry]')).toBeNull();
    expect(shadowSection()).toBeNull();
    expect(document.body.textContent).not.toContain('Shadows');
    // Nothing is asked of git at all — neither the status nor the shadow list.
    expect(requests()).toEqual([]);

    // Contrast: git on, the same shadow list → the section is there.
    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    cfg.gitEnabled = true;
    await mount();
    await openDropdown();
    expect(shadowSection()).not.toBeNull();
  });

  it('[ac:ac-klik-pozycji-w-sekcji-shadows-nie-zmi] a click on an item of the Shadows section does not change `branch` in GET /api/git/status — it only navigates to /releases?tab=shadow&ref=<id>', async () => {
    await mount();
    await openDropdown();
    const before = requests().length;

    await act(async () => {
      shadowSection()!.querySelector<HTMLButtonElement>(`[data-git-shadow="${SHADOW.id}"]`)!.click();
    });
    await settle();

    // A per-click `shadowVisit` token in the history state (the current entry's + 1): navigation data only.
    expect(nav.calls).toEqual([
      { to: '/releases', search: { tab: 'shadow', ref: 'run-1/spec' }, state: expect.any(Function) },
    ]);
    const nextState = (nav.calls[0] as { state: (s: { shadowVisit?: number }) => unknown }).state;
    expect(nextState({})).toEqual({ shadowVisit: 1 });
    expect(nextState({ shadowVisit: 7 })).toEqual({ shadowVisit: 8 });
    // No checkout, no write of any kind — the click sent nothing at all.
    expect(requests().slice(before)).toEqual([]);
    expect(requests().every((r) => r.method === 'GET')).toBe(true);
    expect(requests().some((r) => r.path === '/api/git/checkout')).toBe(false);
    // The dropdown closes; no spinner, no lock.
    expect(shadowSection()).toBeNull();
    expect(host.querySelector('[data-git-spinner]')).toBeNull();

    // GET /api/git/status read again still answers the same branch, and the entry shows it.
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['git-status'] });
    });
    await settle();
    expect(requests().filter((r) => r.path === '/api/git/status')).toHaveLength(2);
    expect(qc.getQueryData<GitStatusResponse>(['git-status'])?.branch).toBe('main');
    expect(host.querySelector('[data-git-entry-toggle]')!.textContent).toContain('main');
  });
});
