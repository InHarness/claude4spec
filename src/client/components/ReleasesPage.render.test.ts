// @vitest-environment happy-dom
/**
 * 2.1.45 (M17 `releases-list`) — the `/releases` screen: two tabs, List and
 * Compare, switched in the header next to "+ Create release". The Compare tab's
 * label is „Changes (N)”, N being the unreleased counter — the ONE shared query
 * `useUnreleasedCount` (light delta newest release → current); „Changes” at
 * N = 0 and without any release. A click on the label only switches the tab
 * (no deep link, no URL state). The create-release window warns „No changes
 * since last release” at N = 0 and does not block creation.
 *
 * The screen, its hooks and the shared counter query are real; only the
 * network (`fetch`), the router's `Link`/`useNavigate`, the briefs/pushes lists
 * and the per-item diff cards are stubbed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  return {
    Link: ({ children, to, search }: { children?: unknown; to?: string; search?: unknown }) =>
      React.createElement(
        'a',
        { 'data-to': to, 'data-search': search === undefined ? undefined : JSON.stringify(search) },
        children as never,
      ),
    useNavigate: () => (opts: unknown) => {
      nav.calls.push(opts);
    },
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
    getAvailable: () => undefined,
    listEntities: () => [],
  },
}));
vi.mock('./release/EntityDiffCard.js', async () => {
  const React = await import('react');
  return {
    EntityDiffCard: ({ change }: { change: { slug: string } }) =>
      React.createElement('div', { 'data-entity-card': change.slug }),
  };
});
vi.mock('./release/PageDiffCard.js', async () => {
  const React = await import('react');
  return {
    PageDiffCard: ({ change }: { change: { path: string } }) =>
      React.createElement('div', { 'data-page-card': change.path }),
  };
});

import { ReleasesPage } from './ReleasesPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const release = (id: number, name: string) => ({
  id,
  name,
  slug: name,
  description: `Release ${name}`,
  createdBy: 'user',
  createdAt: `2026-10-0${id}T10:00:00.000Z`,
});

const pageChange = (path: string, op: 'created' | 'modified') => ({
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

/** Newest first, as `GET /api/releases` answers. */
let releaseList: Array<ReturnType<typeof release>>;
/** `total` of the light map newest → current — what the counter sums. */
let summaryTotal: { entities: number; pages: number };
/** The raw delta the Compare tab renders, per `from` release name. */
let rawDiffs: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

const paths = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: String(url).replace(/^\/api\/projects\/[^/]+/, '/api'),
    method: ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
  }));
const counterRequests = () => paths().filter((r) => r.path.includes('?view=operation&summaryOnly=true'));
const rawDiffRequests = () => paths().filter((r) => /\/diff\/current$/.test(r.path));

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

async function mount() {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ReleasesPage)));
  });
  await flush();
}

function tabs(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}
const tabLabels = () => tabs().map((t) => t.textContent);
const compareTab = () => tabs()[1]!;
const listTab = () => tabs()[0]!;
function panel(id: 'list' | 'compare'): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[role="tabpanel"][data-tab-panel="${id}"]`);
  if (!found) throw new Error(`tab panel "${id}" not rendered`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

function headerCreateButton(): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (b) => b.getAttribute('role') !== 'tab' && b.textContent?.trim() === 'Create release',
  );
  if (!found) throw new Error('"Create release" button not rendered');
  return found;
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  nav.calls = [];
  releaseList = [release(2, 'v2'), release(1, 'v1')];
  summaryTotal = { entities: 1, pages: 2 };
  rawDiffs = {
    v2: {
      from: { id: 2, name: 'v2' },
      to: { id: 0, name: 'current' },
      entities: [{ type: 'endpoint', slug: 'e1', op: 'updated', changes: [] }],
      pages: [pageChange('a.md', 'modified'), pageChange('b.md', 'created')],
    },
    v1: {
      from: { id: 1, name: 'v1' },
      to: { id: 0, name: 'current' },
      entities: [],
      pages: [],
    },
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/api\/projects\/[^/]+/, '/api');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/api/releases' && method === 'GET') return json({ releases: releaseList });
    if (path === '/api/releases' && method === 'POST') {
      return json({ ...release(3, 'v3'), countBreakdown: { entities: {}, pages: 0, total: 0 }, gitSync: null }, 201);
    }
    const summary = path.match(/^\/api\/releases\/([^/]+)\/diff\/current\?view=operation&summaryOnly=true$/);
    if (summary) {
      return json({ data: { from: { name: decodeURIComponent(summary[1]!) }, total: summaryTotal, entities: [], pages: [] } });
    }
    const raw = path.match(/^\/api\/releases\/([^/]+)\/diff\/current$/);
    if (raw) return json(rawDiffs[decodeURIComponent(raw[1]!)]);
    if (/\/snapshot$/.test(path)) return json({ entities: [], pages: [] });
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

describe('/releases screen (M17 releases-list, 2.1.45)', () => {
  it('[entity:releases-list] two tabs in the header next to "+ Create release": List (release cards, newest first) and Compare labelled "Changes (N)"', async () => {
    await mount();

    expect(tabLabels()).toEqual(['Releases', 'Changes (3)']);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    // The header carries the create action beside the tab switcher.
    expect(headerCreateButton()).toBeTruthy();
    // List: one card per release, newest first, linking to its detail.
    const cards = Array.from(host.querySelectorAll('a[data-to="/releases/$name"]'));
    expect(cards.map((c) => c.textContent?.match(/^v\d/)?.[0])).toEqual(['v2', 'v1']);
    expect(host.textContent).toContain('Release v2');

    // Compare: the picker "Compare current state to release", defaulting to the newest.
    await click(compareTab());
    expect(host.textContent).toContain('Compare current state to release:');
    expect(host.querySelector('select')!.value).toBe('v2');
    expect(host.textContent).toContain('v2 → current');
  });

  it('[entity:releases-list] states: "Empty" and "Compare — no releases" without any release (label "Changes", no counter request); "Compare — no changes" when the chosen release equals the current state', async () => {
    releaseList = [];
    await mount();

    // Without any release the counter does not exist: plain "Changes", nothing fetched for it.
    expect(tabLabels()).toEqual(['Releases', 'Changes']);
    expect(counterRequests()).toEqual([]);
    expect(host.textContent).toContain('No releases yet.');
    expect(host.textContent).toContain('Create one to snapshot the current spec state.');
    await click(compareTab());
    expect(host.textContent).toContain('Create a release first');
    expect(rawDiffRequests()).toEqual([]);

    // compare-empty: a release with nothing changed since.
    act(() => root.unmount());
    root = createRoot(host);
    releaseList = [release(1, 'v1')];
    summaryTotal = { entities: 0, pages: 0 };
    qc.clear();
    await mount();
    await click(compareTab());
    expect(host.textContent).toContain('No changes since v1.');
  });

  it('[entity:releases-list] removed: no Compare deep link — the route takes no search params, the screen no tab prop, and nothing links to `?tab=compare`', async () => {
    summaryTotal = { entities: 4, pages: 1 };
    await mount();

    // The M25 banner over the list shows the count but carries no deep link.
    expect(host.querySelector('[data-testid="unreleased-banner"]')?.textContent).toContain('You have 5 unreleased changes');
    const links = Array.from(host.querySelectorAll('a'));
    expect(links.filter((a) => a.getAttribute('data-to') === '/releases')).toEqual([]);
    expect(links.filter((a) => (a.getAttribute('data-search') ?? '').includes('compare'))).toEqual([]);
    // The screen owns its tab: no props in, no URL out.
    expect(ReleasesPage.length).toBe(0);
    const router = readFileSync(join(process.cwd(), 'src/client/router.tsx'), 'utf8');
    expect(router).not.toMatch(/releasesSearchSchema/);
    expect(router).not.toMatch(/tab: z\.enum\(\['list', 'compare'\]\)/);
    expect(router).not.toMatch(/search: \(prev\) => \(\{ \.\.\.prev, tab:/);
  });

  it('[ac:ac-baner-you-have-n-unreleased-changes-p] the banner "You have N unreleased changes" stands over the release list on /releases while the unreleased counter is above 0, N being that counter', async () => {
    summaryTotal = { entities: 4, pages: 3 };
    await mount();

    const banner = host.querySelector<HTMLElement>('[data-testid="unreleased-banner"]');
    expect(banner?.textContent).toBe(
      'You have 7 unreleased changes — they will NOT be included in this push. Pull them into this release or create a new one.',
    );
    // Over the list: before the first release card, inside the List tab.
    const firstCard = host.querySelector('a[data-to="/releases/$name"]')!;
    expect(banner!.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel('list').contains(banner!)).toBe(true);
    // N is the shared counter — the same number as the Compare tab label, one request for both.
    expect(compareTab().textContent).toBe('Changes (7)');
    expect(counterRequests()).toHaveLength(1);
  });

  it('[ac:ac-baner-you-have-n-unreleased-changes-p] no banner over the list while the unreleased counter is 0, nor without any release', async () => {
    summaryTotal = { entities: 0, pages: 0 };
    await mount();
    expect(host.querySelectorAll('a[data-to="/releases/$name"]')).toHaveLength(2);
    expect(host.querySelector('[data-testid="unreleased-banner"]')).toBeNull();
    expect(host.textContent).not.toContain('unreleased change');

    act(() => root.unmount());
    root = createRoot(host);
    releaseList = [];
    summaryTotal = { entities: 4, pages: 3 };
    qc.clear();
    // The second half asserts only its own requests: drop the first mount's
    // counter request (the implementation stays, only the recorded calls go).
    fetchMock.mockClear();
    await mount();
    expect(host.textContent).toContain('No releases yet.');
    expect(host.querySelector('[data-testid="unreleased-banner"]')).toBeNull();
    expect(counterRequests()).toEqual([]);
  });

  it("[ac:ac-etykieta-zakladki-compare-na-releases] the Compare tab label shows \"Changes (N)\" with N equal to the Compare header's global change counter for the newest release", async () => {
    await mount();

    // The counter is read from the light delta of the NEWEST release (head of the list).
    expect(counterRequests().map((r) => r.path)).toEqual([
      '/api/releases/v2/diff/current?view=operation&summaryOnly=true',
    ]);
    expect(compareTab().textContent).toBe('Changes (3)');

    await click(compareTab());
    // Compare defaults to the newest release; its header states the same N in one sentence.
    expect(rawDiffRequests().map((r) => r.path)).toEqual(['/api/releases/v2/diff/current']);
    expect(host.textContent).toContain('3 changes:');
    expect(host.textContent).toContain('2 pages, 1 Endpoint');
  });

  it('[ac:ac-gdy-licznik-niezreleasowanych-zmian-w] with the unreleased counter at 0 the Compare tab label is "Changes" with no number', async () => {
    summaryTotal = { entities: 0, pages: 0 };
    await mount();

    expect(counterRequests()).toHaveLength(1);
    expect(compareTab().textContent).toBe('Changes');
    expect(compareTab().textContent).not.toMatch(/\d/);
  });

  it('[ac:ac-klik-w-licznik-niezreleasowanych-zmian-n] a click on "Changes (N)" switches the screen to the Compare tab — no navigation, no URL change', async () => {
    await mount();
    const urlBefore = window.location.href;
    expect(compareTab().textContent).toBe('Changes (3)');
    expect(compareTab().getAttribute('aria-selected')).toBe('false');

    await click(compareTab());

    expect(compareTab().getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('false');
    expect(host.textContent).toContain('Compare current state to release:');
    // The Compare body is shown and the List body is hidden in its place.
    expect(panel('compare').hidden).toBe(false);
    expect(panel('list').hidden).toBe(true);
    // Only the tab switched: nothing navigated, the URL is unchanged.
    expect(nav.calls).toEqual([]);
    expect(window.location.href).toBe(urlBefore);
  });

  it('[ac:ac-klik-w-licznik-niezreleasowanych-zmian-n] a tab switch only switches the tab: no refetch of the list, pushes, briefs, the counter or the Compare diff', async () => {
    await mount();
    // Mounting /releases: the release list and the counter, nothing for Compare yet.
    expect(rawDiffRequests()).toEqual([]);
    const afterMount = fetchMock.mock.calls.length;

    // First visit of Compare: only what Compare itself shows (its diff, the
    // compared release's snapshot) — the release list is read from cache.
    await click(compareTab());
    const firstVisit = paths().slice(afterMount).map((r) => r.path);
    expect(firstVisit).toEqual(['/api/releases/v2/diff/current', '/api/releases/v2/snapshot']);
    expect(host.textContent).toContain('3 changes:');

    // From then on, switching back and forth costs no request at all.
    const afterFirstVisit = fetchMock.mock.calls.length;
    await click(listTab());
    expect(panel('list').hidden).toBe(false);
    expect(panel('compare').hidden).toBe(true);
    await click(compareTab());
    await click(listTab());
    await click(compareTab());
    expect(fetchMock.mock.calls.length).toBe(afterFirstVisit);
    expect(panel('compare').hidden).toBe(false);
    expect(compareTab().textContent).toBe('Changes (3)');
  });

  it("[ac:ac-strona-releases-ma-dwa-taby-lista-ist] /releases has two tabs, List and Compare; Compare shows the changes from the chosen release to the current state, by default the latest (first of the newest-first list), rendered with the release detail's diff render", async () => {
    await mount();
    expect(tabs()).toHaveLength(2);
    // List: the existing release cards.
    expect(host.querySelectorAll('a[data-to="/releases/$name"]')).toHaveLength(2);

    await click(compareTab());
    // Default = latestReleaseId: the first element of GET /api/releases.
    const select = host.querySelector('select')!;
    expect(select.value).toBe('v2');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['v2 (latest)', 'v1']);
    // From the chosen release TO current — the only direction.
    expect(rawDiffRequests().map((r) => r.path)).toEqual(['/api/releases/v2/diff/current']);
    // The shared DeltaSection render: global counter, page section first, then per-type sections with cards.
    expect(host.textContent).toContain('3 changes:');
    expect(host.textContent).toContain('Pages (2)');
    expect(host.textContent).toContain('Endpoints (1)');
    expect(host.querySelectorAll('[data-page-card]')).toHaveLength(2);
    expect(host.querySelector('[data-entity-card="e1"]')).not.toBeNull();

    // Choosing another release diffs IT against current.
    await act(async () => {
      select.value = 'v1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(rawDiffRequests().map((r) => r.path)).toContain('/api/releases/v1/diff/current');
    expect(host.textContent).toContain('v1 → current');
    expect(host.textContent).toContain('No changes since v1.');
  });

  it("[ac:ac-okno-tworzenia-release-u-ostrzega-no] the create-release window warns \"No changes since last release\" when the unreleased counter is 0, and creating still goes through", async () => {
    summaryTotal = { entities: 0, pages: 0 };
    await mount();
    await click(headerCreateButton());

    const warning = host.querySelector('[data-testid="create-release-empty-warning"]');
    expect(warning?.textContent).toBe('No changes since last release');
    // The window reads the one shared counter query — no second query, no other source.
    const counterQueries = qc
      .getQueryCache()
      .findAll({ queryKey: ['release-diff'] })
      .filter((q) => JSON.stringify(q.queryKey).includes('summaryOnly'));
    expect(counterQueries.map((q) => q.queryKey)).toEqual([['release-diff', 'v2', 'current', { summaryOnly: true }]]);
    // …and opening the window costs no second request for it.
    expect(counterRequests().map((r) => r.path)).toEqual([
      '/api/releases/v2/diff/current?view=operation&summaryOnly=true',
    ]);

    // Not blocking: fill in and submit — the release is created.
    typeInto(host.querySelector('input')!, 'v3');
    typeInto(host.querySelector('textarea')!, 'Bookmark');
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(paths()).toContainEqual({ path: '/api/releases', method: 'POST' });
    expect(nav.calls).toEqual([{ to: '/releases/$name', params: { name: 'v3' } }]);
  });

  it('[ac:ac-okno-tworzenia-release-u-ostrzega-no] no warning in the create-release window while the counter is above 0, nor without any release', async () => {
    await mount();
    await click(headerCreateButton());
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.querySelector('[data-testid="create-release-empty-warning"]')).toBeNull();
    expect(host.textContent).not.toContain('No changes since last release');

    act(() => root.unmount());
    root = createRoot(host);
    releaseList = [];
    qc.clear();
    await mount();
    await click(headerCreateButton());
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.querySelector('[data-testid="create-release-empty-warning"]')).toBeNull();
  });

  /**
   * A git change made outside the app (terminal commit, merge) emits no WS
   * event; the list shows it on its next fetch. The server half — the light
   * delta newest → current is 0 after the commit / the merge — is in
   * `src/server/services/release-diff-git.test.ts`. Here: the reopened list
   * (same app-wide query cache, as in the app) fetches the counter afresh and
   * shows the server's 0, not the stale count from before.
   */
  async function reopenAfterOutsideGitChange() {
    await mount();
    expect(compareTab().textContent).toBe('Changes (3)');
    expect(counterRequests()).toHaveLength(1);

    // Leave the list; the server's delta is now empty.
    act(() => root.unmount());
    summaryTotal = { entities: 0, pages: 0 };

    root = createRoot(host);
    await mount();
    expect(counterRequests()).toHaveLength(2);
    expect(compareTab().textContent).toBe('Changes');
  }

  it('[ac:ac-po-commicie-z-terminala-zmian-zrobion] after a terminal commit of the changes since the last release, the reopened /releases list shows the unreleased counter at 0', async () => {
    await reopenAfterOutsideGitChange();
  });

  it("[ac:ac-po-merge-u-gita-ktory-przyniosl-plik] after a git merge bringing a release file that becomes the newest with content changes, the reopened /releases list shows the unreleased counter at 0", async () => {
    releaseList = [release(1, 'v1')];
    await mount();
    expect(compareTab().textContent).toBe('Changes (3)');
    act(() => root.unmount());

    // The merge put v2 on the axis (newest) and its delta to current is empty.
    releaseList = [release(2, 'v2'), release(1, 'v1')];
    summaryTotal = { entities: 0, pages: 0 };
    root = createRoot(host);
    await mount();

    // The reopened list measures against the NEW newest release and shows 0.
    expect(counterRequests().at(-1)?.path).toBe('/api/releases/v2/diff/current?view=operation&summaryOnly=true');
    expect(qc.getQueryData(['release-diff', 'v2', 'current', { summaryOnly: true }])).toBe(0);
    expect(compareTab().textContent).toBe('Changes');
  });
});
