// @vitest-environment happy-dom
/**
 * 2.1.47 (M17 `releases-list` → Shadows, L5 m17ui001) — accepting a shadow
 * from `/releases`: Accept in the Shadows header (active only without
 * conflicts, files outside the specification and a change in the releases
 * root), the `shadow-accept` window with the preview's payload, the request
 * with the preview's SHAs, the `shadow-accepting` state (spinner, picker and
 * tab switcher locked), the outcome toasts, the repair window for the two new
 * git kinds, the invalidations of a success, and the List card of a release
 * that accepted a shadow.
 *
 * The screen, its hooks and `DeltaSection` are rendered; only the network
 * (`fetch`), the router's `Link`, the config, the entity registry and the
 * briefs/pushes lists are stubbed. The shell's modal host is not mounted: the
 * test answers the `shadow-accept` window through its modal request, as the
 * host would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const cfg = vi.hoisted(() => ({ gitEnabled: true }));
vi.mock('../hooks/useConfig.js', () => ({
  useConfig: () => ({ data: { git: { enabled: cfg.gitEnabled } } }),
}));
vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    Link: ({ children, to }: { children?: unknown; to?: string }) =>
      React.createElement('a', { 'data-to': to }, children as never),
    useNavigate: () => () => {},
  };
});
vi.mock('../hooks/useReleasePushes.js', () => ({
  releasePushesKey: (releaseName: string | undefined) => ['release-pushes', { releaseName }],
  useAllReleasePushes: () => ({ data: [] }),
}));
vi.mock('../hooks/useBriefs.js', () => ({ useBriefs: () => ({ data: [] }) }));
vi.mock('./BriefsList.js', () => ({ ImplementedBadge: () => null }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: {
    listAvailable: () => [{ type: 'endpoint', label: 'Endpoint', labelPlural: 'Endpoints' }],
    getEntity: (type: string) => (type === 'endpoint' ? { pathPrefix: '/endpoints' } : undefined),
    getAvailable: () => undefined,
    listEntities: () => [],
  },
}));
vi.mock('../entities/HostCard.js', async () => {
  const React = await import('react');
  return {
    HostCard: ({ slug }: { slug: string }) => React.createElement('div', { 'data-host-card': slug }),
  };
});
const endpointDef = vi.hoisted(() => ({
  label: 'Endpoint',
  renderCard: () => null,
  useGetBySlug: (slug: string) => ({ data: { slug, title: `master ${slug}` }, isLoading: false }),
}));
vi.mock('../entities/registry.js', () => ({
  getEntityDef: (type: string) => (type === 'endpoint' ? endpointDef : null),
}));
vi.mock('../entities/index.js', () => ({
  getEntityDef: (type: string) => (type === 'endpoint' ? endpointDef : null),
}));

const reload = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../lib/project-reload.js', () => ({
  reloadProjectRoute: () => {
    reload.calls += 1;
  },
}));

import { ReleasesPage } from './ReleasesPage.js';
import { UI_EVENTS, type ModalRequest } from '../ui/events.js';
import { handleGitStatusChanged } from '../lib/git-ws.js';
import { useGitOpsStore } from '../state/gitOps.js';
import { takeGitFlashToast } from '../lib/git-flash.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHADOW = 'run-1/spec';
const TIP = 'bbbbbbb2222222222222222222222222222222';
const HEAD = 'ccccccc3333333333333333333333333333333';
const COMMITS = [
  { sha: TIP, subject: 'Add the orders endpoint', body: 'Covers create and list.' },
  { sha: 'eeeeeee5555555555555555555555555555555', subject: 'Rename the order DTO', body: '' },
];

function shadowDiff(over: Record<string, unknown> = {}) {
  return {
    mode: 'merge',
    shadow: { id: SHADOW, tipSha: TIP },
    head: { sha: HEAD },
    base: { sha: 'aaaaaaa1111111111111111111111111111111' },
    masterAhead: 0,
    conflicts: [],
    mergePreview: true,
    outsideSpecFiles: [],
    touchesReleases: false,
    commits: COMMITS,
    entities: [{ type: 'endpoint', slug: 'get-orders', op: 'created', changes: [] }],
    pages: [],
    before: {},
    ...over,
  };
}

const release = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'v2',
  description: 'Accepted run 1',
  createdBy: 'user',
  createdAt: '2026-10-24 10:00:00.000',
  acceptedShadow: { id: SHADOW, tipSha: TIP },
  countBreakdown: { entities: {}, pages: 0, total: 0 },
  ...over,
});

let diffBody: unknown;
let releases: unknown[];
let acceptAnswer: { status: number; body: unknown };
/** When set, `POST /api/shadow-accept` answers only once it resolves (an acceptance in flight). */
let acceptGate: Promise<void> | null;
let acceptBodies: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;
let toasts: Array<{ variant: string; message: string }>;
let modals: ModalRequest[];
let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);
const onModal = (e: Event) => modals.push((e as CustomEvent).detail);
const paths = () => fetchMock.mock.calls.map(([url]) => String(url).replace(/^\/api\/projects\/[^/]+/, '/api'));
const count = (path: string) => paths().filter((p) => p === path).length;
const diffCount = () => paths().filter((p) => p.startsWith('/api/shadow-diff')).length;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(props: { tab?: 'list' | 'compare' | 'shadow'; shadowRef?: string } = { tab: 'shadow', shadowRef: SHADOW }) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ReleasesPage, props)));
  });
  await flush();
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const acceptButton = () => q<HTMLButtonElement>('[data-shadow-accept]');
const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const panel = (id: string) => host.querySelector<HTMLElement>(`[role="tabpanel"][data-tab-panel="${id}"]`);

async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

/** Accept → the `shadow-accept` window, answered with the fields as „Accept & release” does. */
async function acceptWith(fields: { name: string; description: string } | null) {
  await click(acceptButton());
  const request = modals.find((m) => m.kind === 'shadow-accept') as ModalRequest<'shadow-accept'> | undefined;
  expect(request).toBeDefined();
  await act(async () => {
    if (fields) request!.onSubmit(fields);
    else request!.onCancel();
  });
  await flush();
  return request!;
}

/** The WS map's reaction to `git:status-changed`, its keys invalidated as the socket hook does. */
async function gitStatusChanged(headChanged: boolean) {
  await act(async () => {
    const keys: unknown[][] = [];
    handleGitStatusChanged({ headChanged }, { queue: (k) => keys.push([...k]) });
    await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  });
  await flush();
}

beforeEach(() => {
  reload.calls = 0;
  useGitOpsStore.setState({ ops: [] });
  takeGitFlashToast(); // no flash toast left over from another test
  cfg.gitEnabled = true;
  diffBody = shadowDiff();
  releases = [];
  acceptAnswer = { status: 201, body: { ...release(), gitSync: { status: 'committed', sha: 'f'.repeat(40) } } };
  acceptGate = null;
  acceptBodies = [];
  toasts = [];
  modals = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
    if (path === '/api/shadow-accept' && init?.method === 'POST') {
      acceptBodies.push(JSON.parse(String(init.body)));
      if (acceptGate) await acceptGate;
      return json(acceptAnswer.body, acceptAnswer.status);
    }
    if (path === '/api/releases') return json({ releases });
    if (path === '/api/git/status') {
      return json({ detected: true, rootPath: '/repo', remoteUrl: null, branch: 'main', isDirty: false, ahead: null, behind: null, lastFetchedAt: null });
    }
    if (path === '/api/git/shadows') {
      return json({ shadows: [{ id: SHADOW, tipSha: TIP, tipCommittedAt: '2026-10-23T10:00:00.000Z', tipSubject: 'Spec run' }] });
    }
    if (path.startsWith('/api/shadow-diff')) return json(diffBody);
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  window.addEventListener('c4s:toast', onToast);
  window.addEventListener(UI_EVENTS.MODAL, onModal);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  qc.clear();
  window.removeEventListener('c4s:toast', onToast);
  window.removeEventListener(UI_EVENTS.MODAL, onModal);
  vi.unstubAllGlobals();
});

describe('/releases Shadows tab — accepting a shadow (M17 releases-list, 2.1.47)', () => {
  it('[ac:ac-przycisk-accept-jest-nieaktywny-gdy-p] Accept is inactive when the preview returns a non-empty `conflicts` list — its hint names the conflicting files; with an empty list it is active', async () => {
    diffBody = shadowDiff({ mode: 'shadow-only', conflicts: ['pages/a.md', 'entities/dto/order.json'] });
    await mount();
    expect(acceptButton()).not.toBeNull();
    expect(acceptButton()!.disabled).toBe(true);
    const hint = q('[data-shadow-accept-reason]')!.getAttribute('title')!;
    expect(hint).toContain('Conflicts with master in 2 files');
    expect(hint).toContain('pages/a.md');
    expect(hint).toContain('entities/dto/order.json');
    // An inactive Accept opens nothing.
    await click(acceptButton());
    expect(modals).toEqual([]);

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    diffBody = shadowDiff();
    await mount();
    expect(acceptButton()!.disabled).toBe(false);
    expect(q('[data-shadow-accept-reason]')!.getAttribute('title')).toBeNull();
  });

  it('[entity:releases-list] Accept is inactive with files outside the specification or a change in the releases root, each with its reason; it stays active in "Shadows — no changes"', async () => {
    diffBody = shadowDiff({ outsideSpecFiles: ['src/app.ts'] });
    await mount();
    expect(acceptButton()!.disabled).toBe(true);
    expect(q('[data-shadow-accept-reason]')!.getAttribute('title')).toBe('The shadow changes files outside the specification.');

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    diffBody = shadowDiff({ touchesReleases: true });
    await mount();
    expect(acceptButton()!.disabled).toBe(true);
    expect(q('[data-shadow-accept-reason]')!.getAttribute('title')).toBe('The shadow changes release files.');

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    diffBody = shadowDiff({ entities: [], pages: [] });
    await mount();
    expect(host.textContent).toContain('Accepting this shadow would change nothing in the specification.');
    expect(acceptButton()!.disabled).toBe(false);
  });

  it('[entity:releases-list] [section:m17ui001] Accept opens the shadow-accept window with the preview payload; "Accept & release" sends the preview SHAs, the screen is shadow-accepting meanwhile (spinner, picker and tab switcher locked); a success toasts, invalidates the release list, git-shadows and shadow-diff at once and lands on List', async () => {
    let open!: () => void;
    acceptGate = new Promise<void>((r) => {
      open = r;
    });
    await mount();
    const listBefore = count('/api/releases');
    const shadowsBefore = count('/api/git/shadows');
    const diffsBefore = diffCount();

    const request = await acceptWith({ name: 'v2', description: 'Accepted run 1' });
    expect(request.props).toEqual({ shadowId: SHADOW, tipSha: TIP, headSha: HEAD, commits: COMMITS });
    expect(acceptBodies).toEqual([
      { ref: SHADOW, name: 'v2', description: 'Accepted run 1', expectedTipSha: TIP, expectedHeadSha: HEAD },
    ]);

    // shadow-accepting: spinner, picker locked, the tab switcher locked.
    expect(q('[data-shadow-state="accepting"]')?.textContent).toContain('Accepting the shadow…');
    expect(q<HTMLSelectElement>('[data-shadow-picker]')!.disabled).toBe(true);
    expect(q('[data-tabs-locked]')).not.toBeNull();
    await click(tabs()[1]!);
    expect(panel('shadow')!.hidden).toBe(false);
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');

    await act(async () => open());
    await flush();

    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Shadow accepted as release v2' }));
    expect(modals.filter((m) => m.kind === 'git-sync-recover')).toEqual([]);
    expect(panel('list')!.hidden).toBe(false);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(q('[data-tabs-locked]')).toBeNull();
    // Invalidated right after the answer — no WS event was played here.
    expect(count('/api/releases')).toBeGreaterThan(listBefore);
    expect(count('/api/git/shadows')).toBeGreaterThan(shadowsBefore);
    expect(diffCount()).toBeGreaterThan(diffsBefore);
  });

  it('[section:m17ui001] [section:8i5qf0xx] the release commit\'s git:status-changed { headChanged: true } arriving while THIS client\'s acceptance is in flight does not reload the route: the success toast and the List tab survive; the same event afterwards (another client) reloads', async () => {
    let open!: () => void;
    acceptGate = new Promise<void>((r) => {
      open = r;
    });
    await mount();
    const listBefore = count('/api/releases');
    const shadowsBefore = count('/api/git/shadows');

    await acceptWith({ name: 'v2', description: 'Accepted run 1' });
    expect(useGitOpsStore.getState().ops.map((e) => e.op)).toEqual(['accept']);

    // The server emits the event before it answers (GitService.commit → emitStatusChanged).
    await gitStatusChanged(true);
    expect(reload.calls).toBe(0);
    // The event still refreshes the git reads.
    expect(count('/api/git/shadows')).toBeGreaterThan(shadowsBefore);
    expect(q('[data-shadow-state="accepting"]')).not.toBeNull();

    await act(async () => open());
    await flush();

    expect(reload.calls).toBe(0);
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Shadow accepted as release v2' }));
    expect(panel('list')!.hidden).toBe(false);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(count('/api/releases')).toBeGreaterThan(listBefore);
    // The own-operation mark is consumed by the answer.
    expect(useGitOpsStore.getState().ops).toEqual([]);

    // A HEAD move after the acceptance is another client's — the M31 reload contract.
    await gitStatusChanged(true);
    expect(reload.calls).toBe(1);
  });

  it('[section:m17ui001] [section:8i5qf0xx] the release commit\'s git:status-changed { headChanged: true } arriving AFTER the acceptance\'s answer does not reload the route: the success toast and the List tab survive; the next HEAD move (another client) reloads', async () => {
    await mount();
    const listBefore = count('/api/releases');

    // The answer comes first: the release commit landed, its WS frame is still on the wire.
    await acceptWith({ name: 'v2', description: 'Accepted run 1' });
    expect(reload.calls).toBe(0);
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Shadow accepted as release v2' }));
    expect(panel('list')!.hidden).toBe(false);
    // The mark waits for the acceptance's own HEAD event.
    expect(useGitOpsStore.getState().ops).toEqual([{ op: 'accept', headSeen: false, answered: true }]);

    await gitStatusChanged(true);
    expect(reload.calls).toBe(0);
    expect(takeGitFlashToast()).toBeNull();
    expect(panel('list')!.hidden).toBe(false);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Shadow accepted as release v2' }));
    expect(count('/api/releases')).toBeGreaterThan(listBefore);
    // The event consumed the mark.
    expect(useGitOpsStore.getState().ops).toEqual([]);

    // A later, unrelated HEAD move from another client reloads (M31).
    await gitStatusChanged(true);
    expect(reload.calls).toBe(1);
  });

  it('[section:m17ui001] [section:8i5qf0xx] an answer whose release commit did not land (merge-open) clears the mark at once, so the next HEAD move reloads', async () => {
    acceptAnswer = {
      status: 201,
      body: {
        ...release(),
        gitSync: {
          status: 'error',
          message: 'commit failed',
          recovery: { operation: 'commit-on-release', kind: 'merge-open', reason: 'r', gitStderr: 'e', intentPrompt: 'p' },
        },
      },
    };
    await mount();
    await acceptWith({ name: 'v2', description: 'd' });
    expect(useGitOpsStore.getState().ops).toEqual([]);
    await gitStatusChanged(true);
    expect(reload.calls).toBe(1);
  });

  it('[section:m17ui001] [section:8i5qf0xx] a header Sync started during an acceptance does not take the acceptance\'s HEAD event: no "Updated from the remote" toast, no reload, the Sync keeps its own mark', async () => {
    let open!: () => void;
    acceptGate = new Promise<void>((r) => {
      open = r;
    });
    await mount();
    await acceptWith({ name: 'v2', description: 'Accepted run 1' });
    // The header Sync begins while the acceptance is in flight.
    act(() => useGitOpsStore.getState().begin('sync'));

    // The acceptance's release commit event — attributed to the operation that began first.
    await gitStatusChanged(true);
    expect(reload.calls).toBe(0);
    expect(takeGitFlashToast()).toBeNull();
    expect(useGitOpsStore.getState().ops.map((e) => e.op)).toEqual(['accept', 'sync']);

    await act(async () => open());
    await flush();
    expect(reload.calls).toBe(0);
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Shadow accepted as release v2' }));
    expect(panel('list')!.hidden).toBe(false);
    // The acceptance's mark is gone; the Sync's stays, still unclaimed.
    expect(useGitOpsStore.getState().ops).toEqual([{ op: 'sync', headSeen: false, answered: false }]);

    // The Sync's own HEAD event goes the sync path: its toast is parked for its reload.
    await gitStatusChanged(true);
    expect(reload.calls).toBe(0);
    expect(takeGitFlashToast()).toEqual({ variant: 'success', message: 'Updated from the remote' });
  });

  it('[section:m17ui001] [section:8i5qf0xx] a failure past the point of no return whose error answer says the release commit landed (error.gitSync.status "committed") keeps the mark like a success: its HEAD event arriving after the error does not reload and the error toast survives; the next HEAD move reloads', async () => {
    acceptAnswer = {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL',
          message: "The release 'v2' was created, but reading it back failed: boom",
          gitSync: { status: 'committed', sha: 'f'.repeat(40) },
        },
      },
    };
    await mount();
    await acceptWith({ name: 'v2', description: 'd' });
    expect(toasts).toContainEqual(
      expect.objectContaining({ variant: 'error', message: "The release 'v2' was created, but reading it back failed: boom" }),
    );
    // The answer says HEAD moved: the mark waits for the release commit's event.
    expect(useGitOpsStore.getState().ops).toEqual([{ op: 'accept', headSeen: false, answered: true }]);

    await gitStatusChanged(true);
    expect(reload.calls).toBe(0);
    expect(useGitOpsStore.getState().ops).toEqual([]);

    // The next HEAD move is another client's (M31).
    await gitStatusChanged(true);
    expect(reload.calls).toBe(1);
  });

  it('[section:m17ui001] [section:8i5qf0xx] a 500 whose error answer carries no landed release commit (INTERNAL without gitSync) clears the mark at once, so the next HEAD move reloads', async () => {
    acceptAnswer = { status: 500, body: { error: { code: 'INTERNAL', message: 'git status failed' } } };
    await mount();
    await acceptWith({ name: 'v2', description: 'd' });
    expect(useGitOpsStore.getState().ops).toEqual([]);
    await gitStatusChanged(true);
    expect(reload.calls).toBe(1);
  });

  it('[section:m17ui001] a refused acceptance clears the own-operation mark, so a later HEAD move from another client reloads', async () => {
    acceptAnswer = { status: 500, body: { error: { code: 'ACCEPT_FAILED', message: 'The merge failed' } } };
    await mount();
    await acceptWith({ name: 'v2', description: 'd' });
    expect(useGitOpsStore.getState().ops).toEqual([]);
    await gitStatusChanged(true);
    expect(reload.calls).toBe(1);
  });

  it('[section:m17ui001] cancelling the shadow-accept window sends nothing', async () => {
    await mount();
    await acceptWith(null);
    expect(acceptBodies).toEqual([]);
    expect(q('[data-shadow-state="accepting"]')).toBeNull();
  });

  it('[section:m17ui001] [section:u5vl07ch] a success whose gitSync.status is "error" (merge-open) opens git-sync-recover with its recovery instead of the toast', async () => {
    const recovery = {
      operation: 'commit-on-release',
      kind: 'merge-open',
      reason: 'the merge commit failed',
      gitStderr: 'hook failed',
      intentPrompt: 'Conclude the merge.',
    };
    acceptAnswer = { status: 201, body: { ...release(), gitSync: { status: 'error', message: 'hook failed', recovery } } };
    await mount();
    await acceptWith({ name: 'v2', description: 'Accepted run 1' });
    const recover = modals.filter((m) => m.kind === 'git-sync-recover') as Array<ModalRequest<'git-sync-recover'>>;
    expect(recover).toHaveLength(1);
    expect(recover[0]!.props.recovery).toEqual(recovery);
    expect(toasts.filter((t) => t.variant === 'success')).toEqual([]);
    expect(panel('list')!.hidden).toBe(false);
  });

  it('[section:m17ui001] [section:8i5qf0xx] the refusal ACCEPT_ABORT_FAILED opens git-sync-recover with the recovery of the answer (kind merge-abort-failed), no toast', async () => {
    const recovery = {
      operation: 'commit-on-release',
      kind: 'merge-abort-failed',
      reason: 'git merge --abort failed',
      gitStderr: 'fatal',
      intentPrompt: 'Abort the merge.',
    };
    acceptAnswer = { status: 500, body: { error: { code: 'ACCEPT_ABORT_FAILED', message: 'Undoing the merge failed', recovery } } };
    await mount();
    await acceptWith({ name: 'v2', description: 'Accepted run 1' });
    const recover = modals.filter((m) => m.kind === 'git-sync-recover') as Array<ModalRequest<'git-sync-recover'>>;
    expect(recover).toHaveLength(1);
    expect(recover[0]!.props.recovery).toEqual(recovery);
    expect(toasts).toEqual([]);
    // A refusal stays on the Shadows tab, unlocked.
    expect(panel('shadow')!.hidden).toBe(false);
    expect(q('[data-tabs-locked]')).toBeNull();
  });

  it('[section:m17ui001] refusals: ACCEPT_* / SHADOW_NOT_FOUND / GIT_UNAVAILABLE / validation → a warning with the reason (ACCEPT_STALE also refetches the preview); ACCEPT_FAILED → an error noting that nothing was changed', async () => {
    await mount();

    acceptAnswer = { status: 409, body: { error: { code: 'ACCEPT_STALE', message: 'The shadow or HEAD moved since the preview' } } };
    const before = diffCount();
    await acceptWith({ name: 'v2', description: 'd' });
    expect(toasts.at(-1)).toEqual(expect.objectContaining({ variant: 'warning', message: 'The shadow or HEAD moved since the preview' }));
    expect(diffCount()).toBeGreaterThan(before);

    for (const [code, status] of [
      ['ACCEPT_DIRTY', 409],
      ['SHADOW_NOT_FOUND', 404],
      ['GIT_UNAVAILABLE', 400],
      ['RELEASE_NAME_CONFLICT', 409],
      ['VALIDATION', 400],
    ] as const) {
      modals = [];
      acceptAnswer = { status, body: { error: { code, message: `refused: ${code}` } } };
      await acceptWith({ name: 'v2', description: 'd' });
      expect(toasts.at(-1)).toEqual(expect.objectContaining({ variant: 'warning', message: `refused: ${code}` }));
    }

    modals = [];
    acceptAnswer = { status: 500, body: { error: { code: 'ACCEPT_FAILED', message: 'The merge failed' } } };
    await acceptWith({ name: 'v2', description: 'd' });
    expect(toasts.at(-1)!.variant).toBe('error');
    expect(toasts.at(-1)!.message).toContain('The merge failed');
    expect(toasts.at(-1)!.message).toContain('Nothing was changed');
    expect(modals.filter((m) => m.kind === 'git-sync-recover')).toEqual([]);
  });
});

describe('/releases List — the card of a release that accepted a shadow (2.1.47)', () => {
  it('[ac:ac-karta-wydania-przyjmujacego-cien-na-l] the card of a release that accepted a shadow shows "Accepted shadow {id} @ {sha7}"; the card of a plain release has no such line', async () => {
    releases = [release(), release({ id: 6, name: 'v1', description: 'Plain', acceptedShadow: null })];
    await mount({});
    const lines = Array.from(host.querySelectorAll<HTMLElement>('[data-accepted-shadow]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe(`Accepted shadow ${SHADOW} @ bbbbbbb`);
    const cards = Array.from(host.querySelectorAll<HTMLElement>('[data-to="/releases/$name"]'));
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Accepted shadow');
    expect(cards[1]!.textContent).not.toContain('Accepted shadow');
  });
});
