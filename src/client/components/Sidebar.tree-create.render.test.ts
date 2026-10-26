// @vitest-environment happy-dom
/**
 * 2.1.17 (M02 `66se825m`, slot „Drzewa stron”) — creating and the row menu:
 *
 *  - a new page is created by the `+` at the PAGES header of the page-tree
 *    group, through `POST /api/pages/:rootId`, ALWAYS in the base root (the one
 *    with `builtin: true`), whatever other roots' accordions the sidebar shows
 *    and whichever root the reader is on;
 *  - the row context menu (right click) has ONE item, Rename, on `.md` / `.mdx`
 *    rows only; `.html` rows and folders have no menu; no row offers creating
 *    or deleting an entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageNode, Root as PageRoot, SidebarAccordion } from '../../shared/types.js';

const h = vi.hoisted(() => ({
  pathname: '/space/docs/guides/intro.md',
  roots: [] as PageRoot[],
  accordions: [] as SidebarAccordion[],
  trees: {} as Record<string, PageNode[]>,
  creates: [] as Array<{ rootId: string; path: string; content: string }>,
  popovers: [] as Array<{ kind: string }>,
  navigations: [] as unknown[],
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, params }: { children?: ReactNode; params?: { _splat?: string } }) =>
      createElement('a', { href: params?._splat ?? '#' }, children),
    useNavigate: () => (opts: unknown) => {
      h.navigations.push(opts);
    },
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: h.pathname } }),
  };
});

vi.mock('../hooks/useConfig.js', () => ({
  useRoots: () => h.roots,
  useBaseRootId: () => h.roots.find((r) => r.builtin)?.id ?? null,
  useElementsMenuLayout: () => ({ ready: true, layout: undefined }),
}));

vi.mock('../hooks/usePages.js', () => ({
  usePages: (rootId: string | null) => ({ data: rootId ? h.trees[rootId] ?? [] : [] }),
  useSidebarAccordions: () => ({ data: h.accordions, isSuccess: true }),
  usePagesSearch: () => ({ data: [], isFetching: false }),
}));

vi.mock('../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      // `POST /api/pages/:rootId` — the channel `useCreatePage` calls.
      create: async (rootId: string, path: string, content: string) => {
        h.creates.push({ rootId, path, content });
        return { path, hash: 'h1' };
      },
    },
  };
});

vi.mock('../ui/events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/events.js')>();
  return {
    ...actual,
    // The `new-page` form answers with the path the user typed.
    openPopover: async (kind: string) => {
      h.popovers.push({ kind });
      return { path: 'guides/new-topic.md' };
    },
    toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
  };
});

vi.mock('./UserSection.js', () => ({ UserSection: () => null }));
vi.mock('./GitStatusBadge.js', () => ({ GitStatusBadge: () => null }));
vi.mock('./ProjectSwitcher.js', () => ({ ProjectSwitcher: () => null }));

import { Sidebar } from './Sidebar.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(Sidebar, {
          width: 300,
          cwdPath: '/tmp/x',
          projectName: 'x',
          headerLoading: false,
          entityCounts: {},
          todoCount: 0,
          todoCountByPath: {},
          brokenLinkCount: 0,
          unresolvedMentionCount: 0,
        }),
      ),
    );
  });
}

const row = (path: string) => host.querySelector<HTMLElement>(`[data-page-row="${path}"]`);
const menuItems = () =>
  Array.from(document.body.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent?.trim());

function rightClick(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  h.creates.length = 0;
  h.popovers.length = 0;
  h.navigations.length = 0;
  h.pathname = '/space/docs/guides/intro.md';
  // The base root is NOT first, and its id is not the literal `pages`.
  h.roots = [
    { id: 'docs', name: 'Docs', dir: 'docs', builtin: false },
    { id: 'spec', name: 'Spec', dir: 'pages', builtin: true },
  ];
  // Accordions of another root come first and are open; the reader is on a
  // page of that other root.
  h.accordions = [
    { rootId: 'docs', key: 'all', label: 'Guides', path: '' },
    { rootId: 'spec', key: 'root', label: 'Spec', path: '' },
  ];
  h.trees = {
    docs: [
      {
        type: 'folder',
        name: 'guides',
        path: 'guides',
        children: [
          { type: 'file', name: 'intro.md', path: 'guides/intro.md', fileType: 'markdown' },
          { type: 'file', name: 'widget.mdx', path: 'guides/widget.mdx', fileType: 'markdown' },
          { type: 'file', name: 'preview.html', path: 'guides/preview.html', fileType: 'html' },
        ],
      },
    ],
    spec: [{ type: 'file', name: 'index.md', path: 'index.md', fileType: 'markdown' }],
  } as Record<string, PageNode[]>;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('M02 page-tree group — `+` creates in the base root', () => {
  it('[ac:ac-przycisk-przy-naglowku-grupy-drzew-st] the `+` at the PAGES header creates the page via POST /api/pages/:rootId in the builtin root, though accordions of another root are shown and open', async () => {
    render();
    await flush();
    // Accordions of the other root are on screen and expanded.
    expect(host.textContent).toContain('Guides');
    expect(row('guides/intro.md')).not.toBeNull();

    const plus = host.querySelector<HTMLButtonElement>('button[title="New page"]');
    expect(plus).not.toBeNull();
    await act(async () => {
      plus!.click();
    });
    await flush();

    expect(h.popovers).toEqual([{ kind: 'new-page' }]);
    // Exactly one create, in the base root — not `docs`, where the reader is
    // and whose accordions are open; the folder `guides/` is part of the path,
    // not a separate create.
    expect(h.creates).toHaveLength(1);
    expect(h.creates[0]).toMatchObject({ rootId: 'spec', path: 'guides/new-topic.md' });
    expect(h.creates[0]!.content).toContain('# new topic');
    expect(h.navigations).toEqual([
      { to: '/space/$rootId/$', params: { rootId: 'spec', _splat: 'guides/new-topic.md' } },
    ]);
  });
});

describe('M02 page-tree rows — context menu is Rename only', () => {
  it('[section:66se825m] right click on a .md / .mdx row opens a menu with the single item Rename; no New page, New folder or Delete', async () => {
    render();
    await flush();

    for (const path of ['guides/intro.md', 'guides/widget.mdx']) {
      rightClick(row(path)!);
      expect(menuItems()).toEqual(['Rename…']);
      expect(document.body.textContent).not.toMatch(/New page|New folder|Delete/);
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(menuItems()).toEqual([]);
    }
  });

  it('[section:66se825m] an .html row and a folder have no menu at all', async () => {
    render();
    await flush();

    const html = row('guides/preview.html')!;
    expect(html).not.toBeNull();
    expect(html.querySelector('button[aria-label^="Actions for"]')).toBeNull();
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      html.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented).toBe(false);
    expect(menuItems()).toEqual([]);

    // The folder row is a plain toggle: no row wrapper, no trigger, no menu.
    expect(row('guides')).toBeNull();
    const folderButton = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'guides',
    )!;
    expect(folderButton).toBeDefined();
    rightClick(folderButton);
    expect(menuItems()).toEqual([]);
    // Only markdown rows carry a trigger.
    const triggers = Array.from(host.querySelectorAll('button[aria-label^="Actions for"]')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(triggers).toEqual([
      'Actions for intro.md',
      'Actions for widget.mdx',
      'Actions for index.md',
    ]);
  });
});
