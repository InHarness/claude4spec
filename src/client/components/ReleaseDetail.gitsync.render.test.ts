// @vitest-environment happy-dom
/**
 * 2.1.14 (M28 rhj0h9rl / fxcropku, M17 mbjdcls0, M25 wosnh845) — the release
 * detail page reacts to the `gitSync` field of its two git-backed actions only
 * on `status: 'error'`:
 * - "Pull in unreleased changes" (`PATCH /api/releases/:name` with
 *   `assignUnreleased: true`, the pull commit);
 * - "Push to remote" (the M25 action in the page's `…` menu, the git push hook).
 * Every other result — `committed` / `nothing-to-commit` / `pushed` /
 * `nothing-to-push` / `skipped` / `null` — gives no toast and no window from
 * git; the push keeps only its own remote-push toast.
 *
 * The data hooks are stubbed; the page, its menu, the registered push action
 * and the shell's toast / modal facades are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReleaseDetail as ReleaseDetailData, UpdateReleaseResponse } from '../../shared/entities.js';
import type { ReleasePushResponse } from '../../shared/release-push.js';
import type { GitErrorRecovery } from '../../shared/git.js';
import type { ModalRequest } from '../ui/events.js';

const state = vi.hoisted(() => ({
  release: null as unknown,
  pullGitSync: null as unknown,
  pushGitSync: null as unknown,
  updateCalls: [] as unknown[],
  pushCalls: [] as unknown[],
}));

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    Link: ({ children }: { children?: unknown }) => React.createElement('a', null, children as never),
    useNavigate: () => async () => {},
  };
});
vi.mock('../hooks/useReleases.js', () => ({
  useRelease: () => ({ data: state.release, isLoading: false }),
  useReleaseList: () => ({ data: [state.release] }),
  useReleaseDiff: () => ({ data: undefined }),
  useReleaseSnapshot: () => ({ data: undefined }),
  useRestoreSpec: () => ({ mutateAsync: async () => {} }),
  useUnreleasedCount: () => ({ data: 0 }),
  forgetReleaseName: () => {},
  useUpdateRelease: () => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      state.updateCalls.push(input);
      return { ...(state.release as object), gitSync: state.pullGitSync };
    },
  }),
}));
vi.mock('../hooks/useReleasePushes.js', () => ({
  useReleasePushes: () => ({ data: [] }),
  useAllReleasePushes: () => ({ data: [] }),
  usePushRelease: () => ({
    isPending: false,
    mutateAsync: async (releaseName: string) => {
      state.pushCalls.push(releaseName);
      return {
        id: 3,
        releaseId: 7,
        release: { id: 7, name: releaseName },
        remoteProjectId: '11111111-2222-3333-4444-555555555555',
        remoteReleaseId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
        remoteReleaseSequence: 3,
        contentSha256: 'a'.repeat(64),
        contentSizeBytes: 6,
        deduplicated: false,
        pushedByAccountId: '8c1c2f04-7e21-4f3e-9a1d-2b3c4d5e6f70',
        bundleSchemaVersion: 1,
        status: 'success',
        pushedAt: '2026-10-12T10:00:00.000Z',
        gitSync: state.pushGitSync,
      };
    },
  }),
}));
// A known remote project → a subsequent push: one click, no confirmation window.
vi.mock('../hooks/useConfig.js', () => ({
  useConfig: () => ({ data: { name: 'p', remoteProjectId: '11111111-2222-3333-4444-555555555555' } }),
}));
vi.mock('../hooks/useRemoteAccount.js', () => ({
  useRemoteAccount: () => ({ data: { connected: true, accountStatus: 'active' } }),
}));
vi.mock('./release/DeltaSection.js', () => ({ DeltaSection: () => null }));
vi.mock('./release/ReleaseSelect.js', () => ({ ReleaseSelect: () => null }));
vi.mock('./release/ReleasePushesList.js', () => ({ ReleasePushesList: () => null }));
vi.mock('./CreateBriefDialog.js', () => ({ CreateBriefDialog: () => null }));

import { ReleaseDetail } from './ReleaseDetail.js';
import { UI_EVENTS } from '../ui/events.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RELEASE: ReleaseDetailData = {
  id: 7,
  name: 'v2.1.14',
  description: 'Git gates',
  createdBy: 'user',
  createdAt: '2026-10-12T10:00:00.000Z',
  countBreakdown: { entities: {}, pages: 1, total: 1 },
};

const recovery: GitErrorRecovery = {
  operation: 'pull',
  reason: 'index.lock exists',
  gitStderr: 'fatal: Unable to create index.lock',
  intentPrompt: 'Resolve the git error.',
};

let host: HTMLDivElement;
let root: Root;
let toasts: Array<{ variant: string; message: string }>;
let modals: Array<ModalRequest<'git-sync-recover'>>;
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);
const onModal = (e: Event) => modals.push((e as CustomEvent).detail);

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`button "${label}" not rendered`);
  return found;
}

/** Mounts the release detail page and runs one action from its `…` menu. */
async function runMenuAction(label: string) {
  const qc = new QueryClient();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ReleaseDetail, { name: RELEASE.name })));
  });
  const menu = host.querySelector('button[title="Release actions"]') as HTMLButtonElement | null;
  if (!menu) throw new Error('release actions menu not rendered');
  await act(async () => {
    menu.click();
  });
  await act(async () => {
    button(label).click();
  });
  await flush();
}

beforeEach(() => {
  state.release = RELEASE;
  state.pullGitSync = null;
  state.pushGitSync = null;
  state.updateCalls = [];
  state.pushCalls = [];
  toasts = [];
  modals = [];
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
});

describe('release detail page — gitSync of the pull commit (M17 + M28 2.1.14)', () => {
  const nonError: Array<[string, UpdateReleaseResponse['gitSync']]> = [
    ['committed', { status: 'committed' }],
    ['nothing-to-commit', { status: 'nothing-to-commit' }],
    ['skipped', { status: 'skipped' }],
    ['null', null],
  ];

  it.each(nonError)(
    '[ac:ac-wynik-gitsync-inny-niz-status-error-c] release page: a pull answering gitSync %s gives no toast and no window',
    async (_label, gitSync) => {
      state.pullGitSync = gitSync;
      await runMenuAction('Pull in unreleased changes');

      expect(state.updateCalls).toEqual([{ releaseName: RELEASE.name, assignUnreleased: true }]);
      expect(toasts).toEqual([]);
      expect(modals).toEqual([]);
    },
  );

  it('[ac:ac-wynik-gitsync-inny-niz-status-error-c] release page: a pull answering status "error" opens git-sync-recover, never a toast', async () => {
    state.pullGitSync = { status: 'error', message: 'git commit failed', recovery };
    await runMenuAction('Pull in unreleased changes');

    expect(toasts).toEqual([]);
    expect(modals).toHaveLength(1);
    expect(modals[0]!.kind).toBe('git-sync-recover');
    expect(modals[0]!.props.recovery).toEqual(recovery);
  });
});

describe('release detail page — gitSync of the release push (M25 + M28 2.1.14)', () => {
  const nonError: Array<[string, ReleasePushResponse['gitSync']]> = [
    ['pushed', { status: 'pushed', branch: 'main' }],
    ['nothing-to-push', { status: 'nothing-to-push', branch: 'main' }],
    ['skipped', { status: 'skipped' }],
    ['null', null],
  ];

  it.each(nonError)(
    '[ac:ac-wynik-gitsync-inny-niz-status-error-c] push: a push answering gitSync %s adds no toast and no window of its own — only the remote push toast',
    async (_label, gitSync) => {
      state.pushGitSync = gitSync;
      await runMenuAction('Push to remote');

      expect(state.pushCalls).toEqual([RELEASE.name]);
      // The one toast is the remote push's own — identical whatever git answered.
      expect(toasts.map((t) => ({ variant: t.variant, message: t.message }))).toEqual([
        { variant: 'success', message: 'Pushed as release #3' },
      ]);
      expect(modals).toEqual([]);
    },
  );

  it('[ac:ac-wynik-gitsync-inny-niz-status-error-c] push: a push answering status "error" opens git-sync-recover and adds no git toast', async () => {
    const pushRecovery: GitErrorRecovery = { ...recovery, operation: 'push', reason: 'no upstream' };
    state.pushGitSync = { status: 'error', branch: 'main', recovery: pushRecovery };
    await runMenuAction('Push to remote');

    expect(toasts.map((t) => t.message)).toEqual(['Pushed as release #3']);
    expect(modals).toHaveLength(1);
    expect(modals[0]!.kind).toBe('git-sync-recover');
    expect(modals[0]!.props.recovery).toEqual(pushRecovery);
  });
});
