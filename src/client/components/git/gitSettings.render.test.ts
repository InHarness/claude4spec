// @vitest-environment happy-dom
/**
 * 2.1.49 (M28 rhj0h9rl / fxcropku) — the `#git` settings card reads the
 * repository status from `GET /api/git/status` (query `["git-status"]`): with
 * `detected: false` it shows the muted empty state and hides every
 * sub-control, while the master switch stays on for a future repository.
 * With a detected repository it renders the commit-target selector, whose
 * branch lists come from `GET /api/git/branches` (query `["git-branches"]`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useMemo, useState } from 'react';
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

const key = (k: ConfigKeyPath) => k.join('.');

/** The card's draft as the settings page keeps it: edits and live errors re-render the element. */
function Harness({ initial }: { initial: Record<string, unknown> }) {
  const decl = GIT_SETTINGS.elements!.find((e) => e.id === 'git-integration')!;
  const Element = decl.component!;
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const draft = useMemo<CardDraft>(
    () => ({
      get: (k) => values[key(k)],
      set: (k, v) => setValues((prev) => ({ ...prev, [key(k)]: v })),
      error: (k) => errors[key(k)] ?? null,
      setLiveError: (k, message) =>
        setErrors((prev) => {
          if ((prev[key(k)] ?? null) === message) return prev;
          const next = { ...prev };
          if (message === null) delete next[key(k)];
          else next[key(k)] = message;
          return next;
        }),
      isDirty: () => false,
      saving: false,
      setBusy: () => {},
    }),
    [values, errors],
  );
  const config = { git: { enabled: true } } as unknown as ConfigResponse;
  return createElement(Element, { config, draft, decl });
}

async function mount(
  values: Record<string, unknown>,
  settled: RegExp = /No git repository detected|Commit target/,
): Promise<void> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { initial: values })));
  });
  // Settled: by default the status answer rendered one of the two repository states.
  await vi.waitFor(() => expect(host.textContent).toMatch(settled));
}

const checkboxLabels = () =>
  [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((c) => c.closest('label')!.textContent);
const radio = (label: string) =>
  [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) =>
    r.closest('label')!.textContent!.startsWith(label),
  ) ?? null;
const optionsOf = (select: HTMLSelectElement) => [...select.options].map((o) => [o.value, o.textContent]);

beforeEach(() => {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
      requested.push(path);
      if (path === '/api/git/status') return new Response(JSON.stringify(status), { status: 200 });
      if (path === '/api/git/branches') {
        return new Response(JSON.stringify({ current: 'main', branches: ['main', 'feature'] }), { status: 200 });
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
  it('[ac:ac-gdy-adne-repo-git-nie-jest-wykryte-w-pa] [ac:ac-detect-przy-braku-git-w-path-lub] with no git repository detected (detected: false — no repository or no git in PATH), the #git card shows the empty state without any sub-control', async () => {
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

describe('#git settings card — master switch, commit target and branch list (2.1.49)', () => {
  it('[ac:ac-sekcja-git-w-m26-ma-nadrzedny-master-che] the master switch "Enable Git integration" alone turns commit-on-release on (no separate commit checkbox); off hides the push sub-toggle and shows "Git off — using local history only"', async () => {
    status = DETECTED;
    await mount({ 'git.enabled': false, 'git.syncPushOnPush': false }, /Git off/);

    // Off: the master switch only, unchecked; the empty state; no push sub-toggle.
    expect(checkboxLabels()).toHaveLength(1);
    expect(checkboxLabels()[0]).toContain('Enable Git integration');
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(host.textContent).toContain('Git off — using local history only');
    expect(host.textContent).not.toContain('Push on remote push');
    expect(requested).not.toContain('/api/git/status');

    // On: the switch itself carries commit-on-release — its description says so,
    // and no other control is about committing on release.
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Commit target'));
    const labels = checkboxLabels();
    expect(labels[0]).toContain('Enable Git integration');
    expect(labels[0]).toContain('creating a release or pulling unreleased changes automatically git commits');
    expect(labels.some((l) => l!.includes('Push on remote push'))).toBe(true);
    expect(host.textContent).not.toContain('Commit specification on release');
    expect(host.textContent).not.toContain('Git off — using local history only');
  });

  it('[ac:ac-sekcja-git-w-settings-renderuje-selekto] the Commit target selector offers Current / Specific / New; Specific lists the branches from GET /api/git/branches; New has a template with a live preview and a ref-safe check plus a Base branch list defaulting to "(default)"', async () => {
    status = DETECTED;
    await mount({ 'git.enabled': true, 'git.commitTarget.mode': 'current' });

    expect(radio('Current branch')!.checked).toBe(true);
    expect(radio('Specific branch')).not.toBeNull();
    expect(radio('New branch')).not.toBeNull();
    expect(host.querySelectorAll('select')).toHaveLength(0);
    expect(requested).not.toContain('/api/git/branches'); // `current` needs no branch list

    // Specific → the branch list from GET /api/git/branches, the current one marked.
    await act(async () => {
      radio('Specific branch')!.click();
    });
    await vi.waitFor(() => expect(host.querySelectorAll('select option')).toHaveLength(3));
    expect(requested).toContain('/api/git/branches');
    expect(optionsOf(host.querySelector('select')!)).toEqual([
      ['', 'Select a branch…'],
      ['main', 'main (current)'],
      ['feature', 'feature'],
    ]);

    // New → the template input with its live preview, and the Base branch list.
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({ 'git.enabled': true, 'git.commitTarget.mode': 'new', 'git.commitTarget.template': 'feat/{release_slug}' });
    await vi.waitFor(() => expect(host.querySelectorAll('select option')).toHaveLength(3));
    expect(host.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('feat/{release_slug}');
    expect(host.textContent).toContain('preview: feat/preview-release');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const baseSelect = host.querySelector<HTMLSelectElement>('select')!;
    expect(host.textContent).toContain('Base branch');
    expect(optionsOf(baseSelect)).toEqual([
      ['', '(default)'],
      ['main', 'main (current)'],
      ['feature', 'feature'],
    ]);
    expect(baseSelect.value).toBe(''); // base null → the auto-detected default

    // A template whose rendered name is not ref-safe is refused live, under the field.
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({ 'git.enabled': true, 'git.commitTarget.mode': 'new', 'git.commitTarget.template': 'release:{release_slug}' });
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'The template renders to an invalid branch name: "release:preview-release".',
      ),
    );
  });

  it('[ac:ac-gdy-zapisany-committarget-branch-tryb-n] a saved named-mode branch missing from GET /api/git/branches shows an inline warning to pick another; a listed one shows none', async () => {
    status = DETECTED;
    await mount({ 'git.enabled': true, 'git.commitTarget.mode': 'named', 'git.commitTarget.branch': 'gone' });
    await vi.waitFor(() => expect(host.querySelectorAll('select option')).toHaveLength(3));
    expect(host.querySelector('[data-git-branch-missing]')?.textContent).toBe(
      'This branch no longer exists — pick another or it will fail on release.',
    );

    await act(async () => root.unmount());
    root = createRoot(host);
    await mount({ 'git.enabled': true, 'git.commitTarget.mode': 'named', 'git.commitTarget.branch': 'feature' });
    await vi.waitFor(() => expect(host.querySelectorAll('select option')).toHaveLength(3));
    expect(host.querySelector('[data-git-branch-missing]')).toBeNull();
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('feature');
  });
});
