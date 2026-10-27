// @vitest-environment happy-dom
/**
 * 2.1.14 (M28 bramki gita) — the client half of the release commit's outcome.
 * The create-release dialog reads `gitSync` from `POST /api/releases`:
 * - `status: 'error'` with `recovery.kind: 'branch-missing'` (a `named` target
 *   branch that vanished) opens the kind-aware `git-sync-recover` window — the
 *   release itself stays created (the dialog still navigates to it);
 * - `status: 'nothing-to-commit'` is a success with no signal in the UI at all:
 *   no toast and no recovery window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CreateReleaseResponse } from '../../shared/entities.js';
import type { GitErrorRecovery } from '../../shared/git.js';
import type { ModalRequest } from '../ui/events.js';

const nav = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (opts: unknown) => {
    nav.calls.push(opts);
  },
}));
vi.mock('../hooks/useConfig.js', () => ({
  useConfig: () => ({ data: { agent: { disableDirectFilesystemAccess: false } } }),
}));
vi.mock('../chat/startSeededThread.js', () => ({ startSeededThread: () => {} }));

import { CreateReleaseDialog } from './CreateReleaseDialog.js';
import { GitSyncRecover } from '../ui/modals/GitSyncRecover.js';
import { UI_EVENTS } from '../ui/events.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const branchMissing: GitErrorRecovery = {
  operation: 'commit-on-release',
  kind: 'branch-missing',
  reason: "target branch 'spec/releases' does not exist",
  gitStderr: '',
  intentPrompt: 'The configured target branch is gone — recreate it or change the target.',
};

let host: HTMLDivElement;
let root: Root;
let createResponse: CreateReleaseResponse;
let requests: Array<{ path: string; method: string }>;
let toasts: unknown[];
let modals: Array<ModalRequest<'git-sync-recover'>>;
let closed: number;
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);
const onModal = (e: Event) => modals.push((e as CustomEvent).detail);

function releaseWith(
  gitSync: CreateReleaseResponse['gitSync'],
  gitPush: CreateReleaseResponse['gitPush'] = null,
): CreateReleaseResponse {
  return {
    id: 7,
    name: 'v2.1.14',
    description: 'Git gates',
    createdBy: 'user',
    createdAt: '2026-10-12T10:00:00.000Z',
    countBreakdown: { entities: {}, pages: 1, total: 1 },
    gitSync,
    gitPush,
  };
}

/** Renders the window a captured `git-sync-recover` request asks for, in place of the dialog. */
async function renderRecoverWindow(request: ModalRequest<'git-sync-recover'>) {
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(GitSyncRecover, { request, onClose: () => {} }),
      ),
    );
  });
  await flush();
}

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Mounts the dialog, fills name + description and submits it. */
async function createRelease() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(CreateReleaseDialog, {
          onClose: () => {
            closed += 1;
          },
        }),
      ),
    );
  });
  typeInto(host.querySelector('input')!, 'v2.1.14');
  typeInto(host.querySelector('textarea')!, 'Git gates');
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

beforeEach(() => {
  nav.calls = [];
  requests = [];
  toasts = [];
  modals = [];
  closed = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push({ path, method });
      if (path === '/api/releases' && method === 'POST') {
        return new Response(JSON.stringify(createResponse), { status: 201 });
      }
      // 2.1.45: the dialog reads the shared unreleased counter, which first lists releases.
      if (path === '/api/releases' && method === 'GET') {
        return new Response(JSON.stringify({ releases: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
  window.addEventListener(UI_EVENTS.TOAST, onToast);
  window.addEventListener(UI_EVENTS.MODAL, onModal);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(UI_EVENTS.TOAST, onToast);
  window.removeEventListener(UI_EVENTS.MODAL, onModal);
  vi.unstubAllGlobals();
});

describe('create-release dialog — gitSync outcome of commitOnRelease (M28 2.1.14)', () => {
  it('[ac:ac-gdy-docelowy-branch-tryb-named-zniknal] a branch-missing commit error keeps the release created and opens the kind-aware git-sync-recover window naming the vanished target branch', async () => {
    createResponse = releaseWith({ status: 'error', recovery: branchMissing });
    await createRelease();

    expect(requests).toContainEqual({ path: '/api/releases', method: 'POST' });
    // The release is durable: the dialog closes and navigates to it.
    expect(closed).toBe(1);
    expect(nav.calls).toEqual([{ to: '/releases/$name', params: { name: 'v2.1.14' } }]);
    // A window, not a toast.
    expect(toasts).toEqual([]);
    expect(modals).toHaveLength(1);
    expect(modals[0]!.kind).toBe('git-sync-recover');
    expect(modals[0]!.props.recovery.kind).toBe('branch-missing');

    // The window is kind-aware: it says WHY — the target branch is gone.
    await renderRecoverWindow(modals[0]!);
    expect(host.textContent).toContain('Done — but git sync hit a problem');
    expect(host.textContent).toContain(`Committing the release failed: ${branchMissing.reason}`);
    expect(host.querySelector('[data-git-recover-kind-hint]')?.textContent).toBe(
      'The configured target branch no longer exists.',
    );
  });

  it('[ac:ac-gdy-git-add-niczego-nie-wniosl-commi] a nothing-to-commit outcome is a plain success with no UI signal — no toast and no recovery window', async () => {
    createResponse = releaseWith({ status: 'nothing-to-commit' });
    await createRelease();

    expect(requests).toContainEqual({ path: '/api/releases', method: 'POST' });
    // Success: the dialog closes and navigates to the new release, no error shown.
    expect(closed).toBe(1);
    expect(nav.calls).toEqual([{ to: '/releases/$name', params: { name: 'v2.1.14' } }]);
    // No signal of any kind.
    expect(toasts).toEqual([]);
    expect(modals).toEqual([]);
  });

  const nonError: Array<[string, CreateReleaseResponse['gitSync']]> = [
    ['committed', { status: 'committed', branch: 'main', switched: false }],
    ['nothing-to-commit', { status: 'nothing-to-commit' }],
    ['skipped', { status: 'skipped', message: 'pages are outside the repository' }],
    ['null', null],
  ];

  it.each(nonError)(
    '[ac:ac-wynik-gitsync-inny-niz-status-error-c] release page: a gitSync of %s on createRelease gives no toast and no window',
    async (_label, gitSync) => {
      createResponse = releaseWith(gitSync);
      await createRelease();

      expect(requests).toContainEqual({ path: '/api/releases', method: 'POST' });
      expect(closed).toBe(1);
      expect(nav.calls).toEqual([{ to: '/releases/$name', params: { name: 'v2.1.14' } }]);
      expect(toasts).toEqual([]);
      expect(modals).toEqual([]);
    },
  );

  it('[ac:ac-wynik-gitsync-inny-niz-status-error-c] release page: only status "error" reacts — it opens git-sync-recover, never a toast', async () => {
    createResponse = releaseWith({
      status: 'error',
      message: 'git commit failed',
      recovery: {
        operation: 'commit-on-release',
        reason: 'index.lock exists',
        gitStderr: 'fatal: Unable to create index.lock',
        intentPrompt: 'Resolve the git error.',
      },
    });
    await createRelease();

    expect(toasts).toEqual([]);
    expect(modals).toHaveLength(1);
    expect(modals[0]!.kind).toBe('git-sync-recover');
  });
});

/**
 * 2.1.55 (M17 m17ui001 „Naprawa po przyjęciu”, M28 u5vl07ch / fxcropku) — the
 * push that follows the release commit answers in `gitPush`, separate from
 * `gitSync`. The release page opens the same `git-sync-recover` window when
 * `gitPush.status === 'error'`, with the recovery of `gitPush`; every other
 * push result, `null` included, gives no signal.
 */
describe('create-release dialog — gitPush outcome of the push on release (2.1.55)', () => {
  const committed: CreateReleaseResponse['gitSync'] = { status: 'committed', sha: 'abc1234', branch: 'main', switched: false };
  const rejected: GitErrorRecovery = {
    operation: 'push',
    kind: 'non-fast-forward',
    reason: 'the remote rejected the push (non-fast-forward)',
    gitStderr: ' ! [rejected]        main -> main (fetch first)',
    intentPrompt: 'Bring the remote commits in, then push again.',
  };
  const noUpstream: GitErrorRecovery = {
    operation: 'push',
    reason: "branch 'main' has no upstream",
    gitStderr: 'fatal: The current branch main has no upstream branch.',
    intentPrompt: 'Set an upstream for main, then push it.',
  };

  it('[ac:ac-gdy-gitsync-status-error-operacje] a gitPush error after createRelease opens git-sync-recover (not a toast) with the recovery of gitPush — the release stays created; non-fast-forward offers [Sync] + [Dismiss]', async () => {
    createResponse = releaseWith(committed, {
      status: 'error',
      branch: 'main',
      message: 'push rejected',
      recovery: rejected,
    });
    await createRelease();

    // The release exists: the dialog closes and navigates to it.
    expect(closed).toBe(1);
    expect(nav.calls).toEqual([{ to: '/releases/$name', params: { name: 'v2.1.14' } }]);
    // A window, not a toast, carrying the push's own recovery.
    expect(toasts).toEqual([]);
    expect(modals).toHaveLength(1);
    expect(modals[0]!.kind).toBe('git-sync-recover');
    expect(modals[0]!.props.recovery).toEqual(rejected);

    await renderRecoverWindow(modals[0]!);
    expect(host.textContent).toContain('Release created — but git push hit a problem');
    expect(host.textContent).toContain(`Pushing to the remote failed: ${rejected.reason}`);
    expect(host.querySelector('[data-git-recover-sync]')?.textContent).toBe('Sync');
    expect(host.querySelector('[data-git-recover-dismiss]')?.textContent).toBe('Dismiss');
    expect(host.querySelector('[data-git-recover-agent]')).toBeNull();
  });

  it('[ac:ac-gdy-gitsync-status-error-operacje] a plain gitPush error (no kind) opens the window with [Fix it with Agent] + [Dismiss]', async () => {
    createResponse = releaseWith(committed, { status: 'error', branch: 'main', recovery: noUpstream });
    await createRelease();

    expect(toasts).toEqual([]);
    expect(modals).toHaveLength(1);
    expect(modals[0]!.props.recovery).toEqual(noUpstream);

    await renderRecoverWindow(modals[0]!);
    expect(host.querySelector('[data-git-recover-agent]')?.textContent).toBe('Fix it with Agent');
    expect(host.querySelector('[data-git-recover-dismiss]')?.textContent).toBe('Dismiss');
    expect(host.querySelector('[data-git-recover-sync]')).toBeNull();
  });

  const nonErrorPush: Array<[string, CreateReleaseResponse['gitPush']]> = [
    ['pushed', { status: 'pushed', branch: 'main' }],
    ['nothing-to-push', { status: 'nothing-to-push', branch: 'main' }],
    ['skipped', { status: 'skipped' }],
    ['null', null],
  ];

  it.each(nonErrorPush)(
    '[section:fxcropku] a gitPush of %s after a committed release gives no toast and no window',
    async (_label, gitPush) => {
      createResponse = releaseWith(committed, gitPush);
      await createRelease();

      expect(closed).toBe(1);
      expect(nav.calls).toEqual([{ to: '/releases/$name', params: { name: 'v2.1.14' } }]);
      expect(toasts).toEqual([]);
      expect(modals).toEqual([]);
    },
  );
});

/**
 * M28 edge case: a failing git operation never changes the outcome of the
 * release — the server half (201/200 with `gitSync.status: 'error'`, a
 * message and `recovery`) is in `src/server/routes/releases.test.ts`; this is
 * the UI half: the release is created and the window, not a toast, offers
 * "Fix it with Agent".
 */
describe('create-release dialog — a failed git operation keeps the release (M28)', () => {
  it('[ac:ac-b-d-operacji-git-brak-gita-w-path-bra] a gitSync error on createRelease leaves the release created and opens git-sync-recover with Fix it with Agent instead of a toast', async () => {
    const gitMissing: GitErrorRecovery = {
      operation: 'commit-on-release',
      reason: 'spawn git ENOENT',
      gitStderr: '',
      intentPrompt: 'Install git or put it on PATH, then commit the release.',
    };
    createResponse = releaseWith({ status: 'error', message: 'spawn git ENOENT', recovery: gitMissing });
    await createRelease();

    // The release outcome is unchanged: created, the dialog navigates to it, no error in the form.
    expect(closed).toBe(1);
    expect(nav.calls).toEqual([{ to: '/releases/$name', params: { name: 'v2.1.14' } }]);
    expect(host.textContent).not.toContain('spawn git ENOENT');
    // The window, not a toast.
    expect(toasts).toEqual([]);
    expect(modals).toHaveLength(1);
    expect(modals[0]!.kind).toBe('git-sync-recover');
    expect(modals[0]!.props.recovery).toEqual(gitMissing);

    await renderRecoverWindow(modals[0]!);
    expect(host.textContent).toContain('Done — but git sync hit a problem');
    expect(host.querySelector('[data-git-recover-agent]')?.textContent).toBe('Fix it with Agent');
    expect(host.querySelector('[data-git-recover-dismiss]')?.textContent).toBe('Dismiss');
  });
});
