// @vitest-environment happy-dom
/**
 * 2.1.49 (M28 rhj0h9rl / fxcropku) — the `#git` settings card reads the
 * repository status from `GET /api/git/status` (query `["git-status"]`): with
 * `detected: false` it shows the muted empty state and hides every
 * sub-control, while the master switch stays on for a future repository.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GitStatusResponse } from '../../../shared/git.js';
import type { ConfigResponse } from '../../lib/api.js';
import type { CardDraft, ConfigKeyPath } from '../settings/registry.js';

vi.mock('../../lib/project-reload.js', () => ({ reloadProjectRoute: () => {} }));

import { GIT_SETTINGS } from './gitSettings.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOT_DETECTED: GitStatusResponse = {
  detected: false,
  rootPath: null,
  remoteUrl: null,
  branch: null,
  isDirty: false,
  ahead: null,
  behind: null,
  lastFetchedAt: null,
};

const DETECTED: GitStatusResponse = {
  detected: true,
  rootPath: '/repo',
  remoteUrl: 'git@example.com:spec.git',
  branch: 'main',
  isDirty: false,
  ahead: 0,
  behind: 0,
  lastFetchedAt: null,
};

let host: HTMLDivElement;
let root: Root;
let status: GitStatusResponse;
let requested: string[];

function draftOf(values: Record<string, unknown>): CardDraft {
  const key = (k: ConfigKeyPath) => k.join('.');
  return {
    get: (k) => values[key(k)],
    set: (k, v) => {
      values[key(k)] = v;
    },
    error: () => null,
    setLiveError: () => {},
    isDirty: () => false,
    saving: false,
    setBusy: () => {},
  };
}

async function mount(values: Record<string, unknown>): Promise<void> {
  const decl = GIT_SETTINGS.elements!.find((e) => e.id === 'git-integration')!;
  const Element = decl.component!;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const config = { git: { enabled: true } } as unknown as ConfigResponse;
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: qc }, createElement(Element, { config, draft: draftOf(values), decl })),
    );
  });
  // Settled: the status answer rendered one of the two repository states.
  await vi.waitFor(() => expect(host.textContent).toMatch(/No git repository detected|Commit target/));
}

beforeEach(() => {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
      requested.push(path);
      if (path === '/api/git/status') return new Response(JSON.stringify(status), { status: 200 });
      if (path === '/api/git/branches') {
        return new Response(JSON.stringify({ current: 'main', branches: ['main'] }), { status: 200 });
      }
      throw new Error(`unexpected request ${path}`);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('#git settings card — repository status from GET /api/git/status', () => {
  it('[ac:ac-gdy-adne-repo-git-nie-jest-wykryte-w-pa] with no git repository detected, the #git card shows the empty state without any sub-control', async () => {
    status = NOT_DETECTED;
    await mount({ 'git.enabled': true, 'git.commitTarget.mode': 'named', 'git.commitTarget.branch': 'main' });

    expect(requested).toContain('/api/git/status');
    // The branch list feeds only the hidden commit-target lists — not read.
    expect(requested).not.toContain('/api/git/branches');
    expect(host.textContent).toContain(
      'No git repository detected. Git sync options are available only when your pages live inside a git repository.',
    );
    // Only the master switch is left — on, kept for a future repository.
    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]!.checked).toBe(true);
    expect(host.textContent).toContain('Enable Git integration');
    // No sub-control: no info card, no push toggle, no commit-target selector or branch list.
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(host.querySelectorAll('select')).toHaveLength(0);
    expect(host.querySelectorAll('input[type="text"]')).toHaveLength(0);
    expect(host.textContent).not.toContain('Commit target');
    expect(host.textContent).not.toContain('Working tree');
    expect(host.textContent).not.toContain('Switch to branch after release');
  });

  it('[ac:ac-gdy-adne-repo-git-nie-jest-wykryte-w-pa] the same card with a detected repository renders the sub-controls (the empty state is tied to detected: false)', async () => {
    status = DETECTED;
    await mount({ 'git.enabled': true, 'git.commitTarget.mode': 'current' });

    expect(host.textContent).not.toContain('No git repository detected');
    expect(host.textContent).toContain('Commit target');
    expect(host.textContent).toContain('Working tree');
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(1);
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  });
});
