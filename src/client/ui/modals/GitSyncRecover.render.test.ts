// @vitest-environment happy-dom
/**
 * 2.1.10 (M28 u5vl07ch, 8i5qf0xx "Okna") — the `git-sync-recover` window.
 * A `gitSync.status === 'error'` result opens it (not a toast) with success
 * framing, the operation context and the raw stderr in an expandable block;
 * actions `Fix it with Agent` + `Dismiss`, and for `recovery.kind:
 * 'non-fast-forward'` `Sync` + `Dismiss` instead — `Sync` calls
 * `POST /api/git/sync` and its result is handled by the header's sync toasts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitErrorRecovery, GitSyncResponse } from '../../../shared/git.js';
import type { ModalRequest } from '../events.js';

const reload = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../lib/project-reload.js', () => ({
  reloadProjectRoute: () => {
    reload.calls += 1;
  },
}));
const cfg = vi.hoisted(() => ({ disableDirectFilesystemAccess: false }));
vi.mock('../../hooks/useConfig.js', () => ({
  useConfig: () => ({ data: { agent: { disableDirectFilesystemAccess: cfg.disableDirectFilesystemAccess } } }),
}));
const seeded = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../../chat/startSeededThread.js', () => ({
  startSeededThread: (prompt: string) => {
    seeded.prompts.push(prompt);
  },
}));

import { GitSyncRecover } from './GitSyncRecover.js';
import { showGitErrorModal, UI_EVENTS } from '../events.js';
import { takeGitFlashToast } from '../../lib/git-flash.js';
import { useGitOpsStore } from '../../state/gitOps.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plainPushFailure: GitErrorRecovery = {
  operation: 'push',
  reason: "fatal: 'origin' does not appear to be a git repository",
  gitStderr: "fatal: 'origin' does not appear to be a git repository",
  intentPrompt: 'Please fix the push safely.',
};

const nonFastForward: GitErrorRecovery = {
  operation: 'push',
  kind: 'non-fast-forward',
  reason: 'the remote rejected the push (non-fast-forward)',
  gitStderr: ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs',
  intentPrompt: 'Bring the remote commits in, then push again.',
};

let host: HTMLDivElement;
let root: Root;
let toasts: Array<{ variant: string; message: string }>;
let requests: Array<{ path: string; method: string }>;
let syncResult: GitSyncResponse;
/** When set, `POST /api/git/sync` answers only once it resolves (a sync in flight). */
let syncGate: Promise<void> | null;
let closed: unknown[];
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(recovery: GitErrorRecovery) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const request = {
    kind: 'git-sync-recover',
    props: { recovery },
    onSubmit: () => {},
    onCancel: () => {},
  } as ModalRequest<'git-sync-recover'>;
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(GitSyncRecover, { request, onClose: (r: unknown) => closed.push(r) }),
      ),
    );
  });
  await flush();
}

const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const buttonsText = () => Array.from(host.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.click();
  });
  await flush();
};

beforeEach(() => {
  reload.calls = 0;
  cfg.disableDirectFilesystemAccess = false;
  seeded.prompts = [];
  toasts = [];
  requests = [];
  closed = [];
  syncResult = { status: 'up-to-date', paths: null, reason: null, message: null };
  syncGate = null;
  useGitOpsStore.setState({ pending: null });
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
      requests.push({ path, method: (init?.method ?? 'GET').toUpperCase() });
      if (path === '/api/git/sync') {
        if (syncGate) await syncGate;
        return json(syncResult);
      }
      if (path === '/api/git/status') {
        return json({ detected: true, branch: 'main', isDirty: false, ahead: 0, behind: 0, lastFetchedAt: null });
      }
      throw new Error(`unexpected request ${path}`);
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
});

describe('git-sync-recover window (M28 u5vl07ch)', () => {
  it('[ac:ac-gdy-gitsync-status-error-operacje] a gitSync error opens the git-sync-recover window (not a toast) with success framing, the operation context, stderr in an expandable block, and Fix it with Agent + Dismiss', async () => {
    // The openers (M17 release detail, M25 push) call showGitErrorModal: a
    // modal request of kind git-sync-recover carrying the recovery — no toast.
    const opened: Array<ModalRequest<'git-sync-recover'>> = [];
    const onModal = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener(UI_EVENTS.MODAL, onModal);
    showGitErrorModal(plainPushFailure);
    window.removeEventListener(UI_EVENTS.MODAL, onModal);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.kind).toBe('git-sync-recover');
    expect(opened[0]!.props.recovery).toEqual(plainPushFailure);
    expect(toasts).toEqual([]);

    await render(opened[0]!.props.recovery);

    // Framing: the action succeeded, only git sync hit a problem.
    expect(host.textContent).toContain('Done — but git sync hit a problem');
    // Operation context: operation + reason.
    expect(host.textContent).toContain(`Pushing to the remote failed: ${plainPushFailure.reason}`);
    // Raw stderr only after expanding the details block.
    expect(q('[data-git-recover-details]')).toBeNull();
    await click(q('[data-git-recover-details-toggle]'));
    expect(q('[data-git-recover-details]')?.textContent).toContain('operation: push');
    expect(q('[data-git-recover-details]')?.textContent).toContain(plainPushFailure.gitStderr);
    // Actions: Fix it with Agent + Dismiss, no Sync.
    expect(q('[data-git-recover-agent]')?.textContent).toBe('Fix it with Agent');
    expect(q('[data-git-recover-dismiss]')?.textContent).toBe('Dismiss');
    expect(q('[data-git-recover-sync]')).toBeNull();

    // Fix it with Agent seeds a thread with the backend's prompt and closes.
    await click(q('[data-git-recover-agent]'));
    expect(seeded.prompts).toEqual([plainPushFailure.intentPrompt]);
    expect(closed).toEqual([null]);
  });

  it('[ac:ac-gdy-gitsync-status-error-operacje] with recovery.kind "non-fast-forward" the window offers [Sync] instead of [Fix it with Agent], next to [Dismiss]', async () => {
    await render(nonFastForward);

    expect(host.textContent).toContain('Done — but git sync hit a problem');
    expect(q('[data-git-recover-sync]')?.textContent).toBe('Sync');
    expect(q('[data-git-recover-dismiss]')?.textContent).toBe('Dismiss');
    expect(q('[data-git-recover-agent]')).toBeNull();
    expect(buttonsText()).not.toContain('Fix it with Agent');
    // Not the posture hint either — Sync needs no shell.
    expect(host.textContent).not.toContain('Fixing this with the agent needs a shell');

    // Dismiss is a plain close.
    await click(q('[data-git-recover-dismiss]'));
    expect(closed).toEqual([null]);
    expect(requests.filter((r) => r.path === '/api/git/sync')).toEqual([]);
  });

  it('[ac:ac-okno-git-sync-recover-dla-recovery-ki] the git-sync-recover window for recovery.kind "non-fast-forward" shows the Sync action, which calls POST /api/git/sync', async () => {
    cfg.disableDirectFilesystemAccess = true; // irrelevant to Sync
    await render(nonFastForward);

    expect(q('[data-git-recover-kind-hint]')?.textContent).toBe("The remote has commits you don't have yet.");
    const sync = q('[data-git-recover-sync]');
    expect(sync?.textContent).toBe('Sync');

    await click(sync);

    expect(requests).toContainEqual({ path: '/api/git/sync', method: 'POST' });
    // Result handled by the sync toasts: up-to-date → "Already up to date".
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Already up to date' }));
    expect(closed).toEqual([null]);
    expect(reload.calls).toBe(0);
  });

  it('[ac:ac-okno-git-sync-recover-dla-recovery-ki] Sync that moved HEAD reloads the project route with "Updated from the remote" parked across the reload', async () => {
    syncResult = { status: 'fast-forwarded', paths: null, reason: null, message: null };
    await render(nonFastForward);

    await click(q('[data-git-recover-sync]'));

    expect(reload.calls).toBe(1);
    expect(takeGitFlashToast()).toEqual({ variant: 'success', message: 'Updated from the remote' });
    expect(closed).toEqual([null]);
  });

  it('Sync refusals use the sync toasts; busy stays in the window as a hint', async () => {
    syncResult = { status: 'diverged', paths: ['pages/index.md'], reason: 'conflicts', message: null };
    await render(nonFastForward);
    await click(q('[data-git-recover-sync]'));
    expect(toasts).toContainEqual(
      expect.objectContaining({
        variant: 'warning',
        message: 'Your branch and the remote have conflicting changes in 1 file — resolve them in a terminal',
      }),
    );
    expect(closed).toEqual([null]);

    act(() => root.unmount());
    root = createRoot(host);
    closed = [];
    toasts = [];
    syncResult = { status: 'busy', paths: null, reason: null, message: null };
    await render(nonFastForward);
    await click(q('[data-git-recover-sync]'));
    expect(q('[data-git-recover-sync-hint]')?.textContent).toBe(
      'A background task is running — try again in a moment',
    );
    expect(closed).toEqual([]);
    expect(toasts).toEqual([]);
  });

  describe('a Sync in flight (review rev-0001)', () => {
    function holdSync() {
      let release!: () => void;
      syncGate = new Promise<void>((r) => {
        release = r;
      });
      return async () => {
        release();
        await flush();
      };
    }

    it('the window cannot be dismissed while Sync is in flight — Dismiss is disabled, Esc does nothing, the header ✕ is gone', async () => {
      const finish = holdSync();
      await render(nonFastForward);
      // Before Sync the window is dismissible: the header ✕ is there.
      expect(q('button[aria-label="Close"]')).not.toBeNull();

      await click(q('[data-git-recover-sync]'));
      expect(useGitOpsStore.getState().pending).toBe('sync');
      expect(q('[data-git-recover-sync]')?.textContent).toBe('Syncing…');

      const dismissBtn = q('[data-git-recover-dismiss]') as HTMLButtonElement;
      expect(dismissBtn.disabled).toBe(true);
      await click(dismissBtn);
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      // Mousedown on the scrim (the dialog root itself) does not close it either.
      await act(async () => {
        q('[role="dialog"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      await flush();
      expect(closed).toEqual([]);
      // The header ✕ is not rendered while the window is not dismissible.
      expect(q('button[aria-label="Close"]')).toBeNull();

      // The sync finishes; its outcome is handled and only then the window closes.
      await finish();
      expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Already up to date' }));
      expect(closed).toEqual([null]);
      expect(useGitOpsStore.getState().pending).toBeNull();
    });

    it('a Sync that moved HEAD still reloads the project route after its window unmounted mid-flight — the parked toast and the reload are not lost', async () => {
      syncResult = { status: 'merged', paths: null, reason: null, message: null };
      const finish = holdSync();
      await render(nonFastForward);
      await click(q('[data-git-recover-sync]'));
      expect(useGitOpsStore.getState().pending).toBe('sync');

      // The window goes off screen while the request is in flight (e.g. ModalHost
      // replaced it with another window).
      act(() => root.unmount());
      root = createRoot(host);

      await finish();
      expect(reload.calls).toBe(1);
      expect(takeGitFlashToast()).toEqual({ variant: 'success', message: 'Updated from the remote' });
      // The own-op mark is kept for the reload (it consumes it), not orphaned
      // without one.
      expect(useGitOpsStore.getState().pending).toBe('sync');
    });

    it('a refused Sync still shows its toast and clears the own-op mark after its window unmounted mid-flight', async () => {
      syncResult = { status: 'dirty-blocked', paths: ['pages/a.md', 'pages/b.md'], reason: null, message: null };
      const finish = holdSync();
      await render(nonFastForward);
      await click(q('[data-git-recover-sync]'));

      act(() => root.unmount());
      root = createRoot(host);

      await finish();
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'warning', message: 'Commit your local changes to 2 files before syncing' }),
      );
      expect(reload.calls).toBe(0);
      expect(useGitOpsStore.getState().pending).toBeNull();
    });
  });
});
