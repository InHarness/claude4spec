// @vitest-environment happy-dom
/**
 * 2.1.46 (M17 `releases-list` → Shadows, render contract m17ui002) — the
 * Shadows tab of `/releases`: shown with git on and a detected repository; the
 * picker „Compare shadow:” fed by `GET /api/git/shadows`, preset from the `ref`
 * param; the header (`base @ … → shadow @ …`, „master +N commits since base”)
 * and the flag banners; the delta rendered as Compare does (`merge`) or under
 * the conflict list (`shadow-only`); the cards in their shadow form; the states
 * `shadow-none`, `shadow-gone`, `shadow-no-changes`, `shadow-error`.
 *
 * The screen, its hooks, `DeltaSection` and the real diff cards are rendered;
 * only the network (`fetch`), the router's `Link`, the config, the entity
 * registry (one `endpoint` type whose card prints its entity) and the
 * briefs/pushes lists are stubbed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    Link: ({ children, to, params, title }: { children?: unknown; to?: string; params?: unknown; title?: string }) =>
      React.createElement(
        'a',
        { 'data-to': to, 'data-params': params === undefined ? undefined : JSON.stringify(params), title },
        children as never,
      ),
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
    HostCard: ({ slug, entity }: { slug: string; entity: unknown }) =>
      React.createElement('div', { 'data-host-card': slug }, JSON.stringify(entity)),
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

import { RELEASES_TABS, ReleasesPage } from './ReleasesPage.js';
import { handleGitStatusChanged } from '../lib/git-ws.js';
import { shadowDiffInvalidationFor } from '../lib/release-diff-invalidation.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHADOW = 'run-1/spec';
const OTHER = 'run-2/spec';

const pageChange = (path: string, op: 'created' | 'modified' | 'deleted') => ({
  rootId: 'pages',
  path,
  op,
  added_sections: [],
  removed_sections: [],
  modified_sections: [],
  moved_sections: [],
  frontmatter_diff: null,
  xml_refs_diff: null,
});

function shadowDiff(over: Record<string, unknown> = {}) {
  return {
    mode: 'merge',
    shadow: { id: SHADOW, tipSha: 'bbbbbbb2222222222222222222222222222222' },
    head: { sha: 'ccccccc3333333333333333333333333333333' },
    base: { sha: 'aaaaaaa1111111111111111111111111111111' },
    masterAhead: 0,
    conflicts: [],
    mergePreview: true,
    outsideSpecFiles: [],
    touchesReleases: false,
    commits: [{ sha: 'bbbbbbb2222222222222222222222222222222', subject: 'Spec run', body: '' }],
    entities: [
      { type: 'endpoint', slug: 'get-new', op: 'created', changes: [] },
      { type: 'endpoint', slug: 'get-changed', op: 'updated', changes: [] },
      { type: 'endpoint', slug: 'get-gone', op: 'deleted', changes: [] },
    ],
    pages: [pageChange('new.md', 'created'), pageChange('changed.md', 'modified')],
    before: { endpoint: { 'get-gone': { slug: 'get-gone', title: 'Gone on the left side' } } },
    ...over,
  };
}

let shadows: Array<{ id: string; tipSha: string; tipCommittedAt: string; tipSubject: string }>;
let diffs: Record<string, { status: number; body: unknown }>;
let detected: boolean;
let shadowsFail: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

const paths = () => fetchMock.mock.calls.map(([url]) => String(url).replace(/^\/api\/projects\/[^/]+/, '/api'));
const diffRequests = () => paths().filter((p) => p.startsWith('/api/shadow-diff'));

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

/**
 * A `git:status-changed` arriving while the tab is open, played through the
 * two real WS maps: M28's (`["git-status"]`, `["git-shadows"]`) and M17's
 * (the `['shadow-diff']` prefix). Each queued key is invalidated as the
 * watcher's batcher does, so the open tab's queries refetch.
 */
async function gitStatusChanged() {
  await act(async () => {
    const keys: unknown[][] = [];
    handleGitStatusChanged({ headChanged: false }, { queue: (k) => keys.push([...k]) });
    const diffPrefix = shadowDiffInvalidationFor('git:status-changed');
    if (diffPrefix) keys.push([...diffPrefix]);
    await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  });
  await flush();
}

const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const panel = (id: string) => host.querySelector<HTMLElement>(`[role="tabpanel"][data-tab-panel="${id}"]`);
const card = (key: string) => host.querySelector<HTMLElement>(`[data-diff-card="${key}"]`);

beforeEach(() => {
  cfg.gitEnabled = true;
  detected = true;
  shadowsFail = false;
  shadows = [
    { id: SHADOW, tipSha: 'bbbbbbb2222222222222222222222222222222', tipCommittedAt: '2026-10-23T10:00:00.000Z', tipSubject: 'Spec run' },
    { id: OTHER, tipSha: 'ddddddd4444444444444444444444444444444', tipCommittedAt: '2026-10-22T10:00:00.000Z', tipSubject: 'Other run' },
  ];
  diffs = { [SHADOW]: { status: 200, body: shadowDiff() } };
  fetchMock = vi.fn(async (url: string) => {
    const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
    if (path === '/api/releases') return json({ releases: [] });
    if (path === '/api/git/status') {
      return json({ detected, rootPath: '/repo', remoteUrl: null, branch: 'main', isDirty: false, ahead: null, behind: null, lastFetchedAt: null });
    }
    if (path === '/api/git/shadows') {
      return shadowsFail
        ? json({ error: { code: 'INTERNAL', message: 'git for-each-ref failed' } }, 500)
        : json({ shadows });
    }
    const m = path.match(/^\/api\/shadow-diff\?ref=(.*)$/);
    if (m) {
      const answer = diffs[decodeURIComponent(m[1]!)] ?? {
        status: 404,
        body: { error: { code: 'SHADOW_NOT_FOUND', message: 'Shadow not found' } },
      };
      return json(answer.body, answer.status);
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  qc.clear();
  vi.unstubAllGlobals();
});

describe('/releases Shadows tab (M17 releases-list, 2.1.46)', () => {
  it('[entity:releases-list] three tabs with git on and a detected repository — List, Compare, Shadows; `?tab=shadow&ref=<id>` lands on Shadows with the shadow preset in the picker "Compare shadow:"', async () => {
    await mount();

    expect(tabs().map((t) => t.textContent)).toEqual(['Releases', 'Changes', 'Shadows']);
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');
    expect(panel('shadow')!.hidden).toBe(false);
    expect(panel('list')!.hidden).toBe(true);

    expect(host.textContent).toContain('Compare shadow:');
    const picker = host.querySelector<HTMLSelectElement>('[data-shadow-picker]')!;
    expect(picker.value).toBe(SHADOW);
    expect(Array.from(picker.options).map((o) => o.value)).toEqual([SHADOW, OTHER]);
    // The id travels percent-encoded in the query, never in a path segment.
    expect(diffRequests()).toEqual(['/api/shadow-diff?ref=run-1%2Fspec']);

    // Header: the shadow id and `base @ <sha> → shadow @ <sha>`.
    const header = host.querySelector<HTMLElement>('[data-shadow-header]')!;
    expect(header.textContent).toContain(SHADOW);
    expect(header.textContent).toContain('base @ aaaaaaa → shadow @ bbbbbbb');

    // `merge` mode: the Compare render — global counter, pages first, per-type sections.
    expect(host.textContent).toContain('5 changes:');
    expect(host.textContent).toContain('Pages (2)');
    expect(host.textContent).toContain('Endpoints (3)');
    expect(host.querySelector('[data-shadow-conflicts]')).toBeNull();

    // Picking another shadow compares IT.
    diffs[OTHER] = { status: 200, body: shadowDiff({ shadow: { id: OTHER, tipSha: 'ddddddd4444444444444444444444444444444' }, entities: [], pages: [] }) };
    await act(async () => {
      picker.value = OTHER;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(diffRequests()).toContain('/api/shadow-diff?ref=run-2%2Fspec');
    expect(host.querySelector('[data-shadow-header]')!.textContent).toContain(OTHER);
  });

  it('[entity:releases-list] no Shadows tab with git off, nor without a detected repository — a `?tab=shadow` visit lands on the list and asks for no shadow', async () => {
    cfg.gitEnabled = false;
    await mount();
    expect(tabs().map((t) => t.textContent)).toEqual(['Releases', 'Changes']);
    expect(panel('list')!.hidden).toBe(false);
    expect(panel('shadow')).toBeNull();
    expect(paths().filter((p) => p.startsWith('/api/git/'))).toEqual([]);
    expect(diffRequests()).toEqual([]);

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    cfg.gitEnabled = true;
    detected = false;
    await mount();
    expect(tabs().map((t) => t.textContent)).toEqual(['Releases', 'Changes']);
    expect(panel('shadow')).toBeNull();
    expect(diffRequests()).toEqual([]);
  });

  it('[entity:releases-list] a tab switch only switches the tab — the Shadows body stays mounted and nothing is refetched', async () => {
    await mount({});
    expect(diffRequests()).toEqual([]);
    expect(paths()).not.toContain('/api/git/shadows');

    await act(async () => {
      tabs()[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    // Without `ref` the first listed shadow is preselected (ASSUMPTION:dev-4602).
    expect(diffRequests()).toEqual(['/api/shadow-diff?ref=run-1%2Fspec']);
    const after = fetchMock.mock.calls.length;
    for (const i of [0, 2, 1, 2]) {
      await act(async () => {
        tabs()[i]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
    }
    expect(fetchMock.mock.calls.length).toBe(after);
    expect(panel('shadow')!.hidden).toBe(false);
  });

  it('[entity:releases-list] states: "Shadows — none" (empty list), "Shadows — no changes", "Shadows — error"', async () => {
    shadows = [];
    await mount({ tab: 'shadow' });
    expect(host.textContent).toContain('No shadows to compare.');
    expect(diffRequests()).toEqual([]);

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    shadows = [{ id: SHADOW, tipSha: 'b', tipCommittedAt: '2026-10-23T10:00:00.000Z', tipSubject: 's' }];
    diffs[SHADOW] = { status: 200, body: shadowDiff({ entities: [], pages: [{ ...pageChange('same.md', 'modified'), op: 'noop' }] }) };
    await mount();
    expect(host.textContent).toContain('Accepting this shadow would change nothing in the specification.');

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    diffs[SHADOW] = { status: 500, body: { error: { code: 'INTERNAL', message: 'git merge-tree failed' } } };
    await mount();
    const failure = host.querySelector<HTMLElement>('[data-shadow-state="error"]');
    expect(failure?.textContent).toContain('git merge-tree failed');
    expect(host.textContent).not.toContain('This shadow no longer exists');
  });

  it('[entity:releases-list] flag banners: files outside the specification (with their count), a change in the releases root, "Merge preview requires git 2.38 or newer"', async () => {
    diffs[SHADOW] = {
      status: 200,
      body: shadowDiff({ outsideSpecFiles: ['src/a.ts', 'README.md'], touchesReleases: true, mergePreview: false, mode: 'shadow-only' }),
    };
    await mount();
    expect(host.querySelector('[data-shadow-banner="outside-spec"]')?.textContent).toContain('2 files outside the specification');
    expect(host.querySelector('[data-shadow-banner="touches-releases"]')).not.toBeNull();
    expect(host.querySelector('[data-shadow-banner="no-merge-preview"]')?.textContent).toBe(
      'Merge preview requires git 2.38 or newer',
    );

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    diffs[SHADOW] = { status: 200, body: shadowDiff() };
    await mount();
    expect(host.querySelector('[data-shadow-banner]')).toBeNull();
  });

  it('[ac:ac-przy-masterahead-0-naglowek-zakladki] with masterAhead > 0 the Shadows header shows "master +N commits since base"; at 0 it does not', async () => {
    diffs[SHADOW] = { status: 200, body: shadowDiff({ masterAhead: 3 }) };
    await mount();
    const header = host.querySelector<HTMLElement>('[data-shadow-header]')!;
    expect(header.querySelector('[data-master-ahead]')?.textContent).toBe('master +3 commits since base');

    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    diffs[SHADOW] = { status: 200, body: shadowDiff({ masterAhead: 0 }) };
    await mount();
    expect(host.querySelector('[data-shadow-header]')).not.toBeNull();
    expect(host.querySelector('[data-master-ahead]')).toBeNull();
    expect(host.textContent).not.toContain('since base');
  });

  it('[ac:ac-w-trybie-shadow-only-zakladka-shadows] in shadow-only mode the Shadows tab shows the list of conflicting files above the render', async () => {
    diffs[SHADOW] = {
      status: 200,
      body: shadowDiff({ mode: 'shadow-only', conflicts: ['pages/a.md', 'entities/endpoint/get-x.json'] }),
    };
    await mount();

    const conflicts = host.querySelector<HTMLElement>('[data-shadow-conflicts]')!;
    expect(conflicts).not.toBeNull();
    expect(conflicts.textContent).toContain('Conflicts with master — showing what the shadow changed');
    expect(Array.from(conflicts.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'pages/a.md',
      'entities/endpoint/get-x.json',
    ]);
    // Above the render: the delta (its counter and cards) follows the list.
    const delta = host.querySelector<HTMLElement>('[data-shadow-delta]')!;
    expect(delta.textContent).toContain('5 changes:');
    expect(conflicts.compareDocumentPosition(delta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('[ac:ac-zakladka-shadows-z-ref-cienia-ktorego] the Shadows tab with the `ref` of a shadow that no longer exists shows the "shadow-gone" state', async () => {
    shadows = shadows.filter((s) => s.id !== SHADOW);
    delete diffs[SHADOW];
    await mount();

    expect(diffRequests()).toEqual(['/api/shadow-diff?ref=run-1%2Fspec']);
    const gone = host.querySelector<HTMLElement>('[data-shadow-state="gone"]');
    expect(gone?.textContent).toContain('This shadow no longer exists or has been accepted.');
    // Neither a delta nor the generic error state.
    expect(host.querySelector('[data-shadow-delta]')).toBeNull();
    expect(host.querySelector('[data-shadow-state="error"]')).toBeNull();
    // The picker still names the requested shadow.
    expect(host.querySelector<HTMLSelectElement>('[data-shadow-picker]')!.value).toBe(SHADOW);
  });

  it('[ac:ac-karta-elementu-added-w-zakladce-shado] [section:m17ui002] the card of an `added` element in the Shadows tab has no link and the label "shadow only"; modified and deleted cards link to the master version', async () => {
    await mount();

    for (const key of ['endpoint:get-new', 'page:pages/new.md']) {
      const added = card(key)!;
      expect(added, key).not.toBeNull();
      expect(added.querySelectorAll('a'), key).toHaveLength(0);
      expect(added.querySelector('[data-shadow-only]')?.textContent, key).toBe('shadow only');
    }
    // The added entity is not on the master: no full render of a master record.
    expect(card('endpoint:get-new')!.querySelector('[data-host-card]')).toBeNull();

    const modified = card('endpoint:get-changed')!.querySelector<HTMLAnchorElement>('a[data-master-link]')!;
    expect(modified.getAttribute('data-to')).toBe('/endpoints/$slug');
    expect(JSON.parse(modified.getAttribute('data-params')!)).toEqual({ slug: 'get-changed' });
    expect(modified.getAttribute('title')).toBe('Opens the master version');
    const deleted = card('endpoint:get-gone')!.querySelector<HTMLAnchorElement>('a[data-master-link]')!;
    expect(deleted.getAttribute('title')).toBe('Opens the master version');
    const page = card('page:pages/changed.md')!.querySelector<HTMLAnchorElement>('a[data-master-link]')!;
    expect(page.getAttribute('data-to')).toBe('/space/$rootId/$');
    expect(JSON.parse(page.getAttribute('data-params')!)).toEqual({ rootId: 'pages', _splat: 'changed.md' });
    expect(page.getAttribute('title')).toBe('Opens the master version');
    expect(card('endpoint:get-changed')!.querySelector('[data-shadow-only]')).toBeNull();
  });

  it('[ac:ac-karta-encji-usunietej-w-zakladce-shad] [section:m17ui002] the card of a deleted entity in the Shadows tab renders its state from the left side of the delta (`before` of the response)', async () => {
    await mount();

    const deleted = card('endpoint:get-gone')!;
    const render = deleted.querySelector<HTMLElement>('[data-host-card="get-gone"]')!;
    expect(render).not.toBeNull();
    expect(JSON.parse(render.textContent!)).toMatchObject({ slug: 'get-gone', title: 'Gone on the left side' });
    expect(deleted.textContent).toContain('Before the shadow');
    // Not a release snapshot: nothing asked for one.
    expect(paths().filter((p) => p.includes('/snapshot'))).toEqual([]);

    // Without a `before` entry the card says so instead of rendering a master record.
    act(() => root.unmount());
    root = createRoot(host);
    qc.clear();
    diffs[SHADOW] = { status: 200, body: shadowDiff({ before: {} }) };
    await mount();
    expect(card('endpoint:get-gone')!.querySelector('[data-host-card]')).toBeNull();
    expect(card('endpoint:get-gone')!.textContent).toContain('The state before the change is unavailable.');
  });

  it('[entity:releases-list] params: the route validates `tab` (list | compare | shadow) and `ref`, and hands them to the screen', () => {
    expect(RELEASES_TABS).toEqual(['list', 'compare', 'shadow']);
    const router = readFileSync(join(process.cwd(), 'src/client/router.tsx'), 'utf8');
    expect(router).toMatch(/tab: z\.enum\(RELEASES_TABS\)\.optional\(\)\.catch\(undefined\)/);
    expect(router).toMatch(/ref: z\.string\(\)\.min\(1\)\.optional\(\)\.catch\(undefined\)/);
    expect(router).toMatch(/validateSearch: releasesSearch/);
    expect(router).toMatch(/useLocation\(\{ select: \(l\) => l\.state\.__TSR_key \}\)/);
    expect(router).toMatch(/<ReleasesPage tab=\{tab\} shadowRef=\{ref\} visit=\{visit\} \/>/);
  });
  describe('states arising under an open tab (git:status-changed refetches the list and the delta)', () => {
    it('[entity:releases-list] the list empties under an open tab (no `ref`) → "Shadows — none", the previous delta gone', async () => {
      await mount({ tab: 'shadow' });
      expect(host.querySelector('[data-shadow-delta]')).not.toBeNull();

      shadows = [];
      await gitStatusChanged();

      expect(host.textContent).toContain('No shadows to compare.');
      expect(host.querySelector('[data-shadow-delta]')).toBeNull();
      expect(host.querySelector('[data-shadow-header]')).toBeNull();
      expect(host.querySelector('[data-shadow-picker]')).toBeNull();
    });

    it('[ac:ac-zakladka-shadows-z-ref-cienia-ktorego] the shown shadow is accepted under an open tab → "shadow-gone" alone, the stale delta not rendered next to it', async () => {
      await mount();
      expect(card('endpoint:get-new')).not.toBeNull();
      const before = diffRequests().length;

      shadows = shadows.filter((s) => s.id !== SHADOW);
      delete diffs[SHADOW];
      await gitStatusChanged();

      expect(diffRequests().length).toBe(before + 1);
      expect(host.querySelector('[data-shadow-state="gone"]')?.textContent).toContain(
        'This shadow no longer exists or has been accepted.',
      );
      expect(host.querySelector('[data-shadow-delta]')).toBeNull();
      expect(host.querySelector('[data-shadow-header]')).toBeNull();
      expect(card('endpoint:get-new')).toBeNull();
      expect(host.querySelector('[data-shadow-state="error"]')).toBeNull();
      expect(host.querySelector<HTMLSelectElement>('[data-shadow-picker]')!.value).toBe(SHADOW);
    });

    it('[entity:releases-list] the delta becomes empty under an open tab → "Shadows — no changes", the previous cards gone', async () => {
      await mount();
      expect(card('endpoint:get-changed')).not.toBeNull();

      diffs[SHADOW] = { status: 200, body: shadowDiff({ entities: [], pages: [], before: {} }) };
      await gitStatusChanged();

      expect(host.textContent).toContain('Accepting this shadow would change nothing in the specification.');
      expect(card('endpoint:get-changed')).toBeNull();
      expect(card('page:pages/new.md')).toBeNull();
      expect(host.textContent).not.toContain('5 changes:');
    });

    it('[entity:releases-list] the delta refetch fails under an open tab → "Shadows — error" alone (no stale header nor delta); a later successful refetch shows the delta again', async () => {
      await mount();
      expect(host.querySelector('[data-shadow-delta]')).not.toBeNull();

      diffs[SHADOW] = { status: 500, body: { error: { code: 'INTERNAL', message: 'git merge-tree failed' } } };
      await gitStatusChanged();

      expect(host.querySelector('[data-shadow-state="error"]')?.textContent).toContain('git merge-tree failed');
      expect(host.querySelector('[data-shadow-delta]')).toBeNull();
      expect(host.querySelector('[data-shadow-header]')).toBeNull();
      expect(host.querySelector('[data-shadow-state="gone"]')).toBeNull();

      diffs[SHADOW] = { status: 200, body: shadowDiff() };
      await gitStatusChanged();

      expect(host.querySelector('[data-shadow-state="error"]')).toBeNull();
      expect(host.querySelector('[data-shadow-delta]')?.textContent).toContain('5 changes:');
    });

    it('[entity:releases-list] the shadow list fails (on open or on a refetch under an open tab) → "Shadows — error", never "none" and never the stale picker / delta', async () => {
      shadowsFail = true;
      await mount({ tab: 'shadow' });
      expect(host.querySelector('[data-shadow-state="error"]')?.textContent).toContain('git for-each-ref failed');
      expect(host.textContent).not.toContain('No shadows to compare.');
      expect(diffRequests()).toEqual([]);

      act(() => root.unmount());
      root = createRoot(host);
      qc.clear();
      shadowsFail = false;
      await mount();
      expect(host.querySelector('[data-shadow-delta]')).not.toBeNull();

      shadowsFail = true;
      await gitStatusChanged();

      expect(host.querySelector('[data-shadow-state="error"]')?.textContent).toContain('git for-each-ref failed');
      expect(host.querySelector('[data-shadow-picker]')).toBeNull();
      expect(host.querySelector('[data-shadow-delta]')).toBeNull();
    });
  });
});
