// @vitest-environment happy-dom
/**
 * 2.1.77 (M50 `0p15a2js`, `76e8kkze`, `8h2a734u`) — the project shell by type,
 * read through capabilities:
 *
 *  - the ELEMENTS section (the sidebar's "Entities" card) exists only with the
 *    capability `entities`; without it the sidebar goes from the page-tree slot
 *    straight to the OTHERS link;
 *  - the OTHERS items Tags (`entities`) and Briefs (`briefs`) drop out of the
 *    list without the capability, the rest keep their order;
 *  - 2.1.86: the Branding strip carries no type — the shell reads neither the
 *    `projectType` key nor `GET /api/workspace/project-types`; the capability
 *    set is its only dependency on the type registry.
 *
 * The capability set and the type list are the host registry's own entries
 * (`HOST_PROJECT_TYPE_ENTRIES`), as `GET /api/config` (`capabilities`, derived
 * from the type by the context factory) and the type-list route serve them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectTypeCard } from '../../shared/project-types.js';

const h = vi.hoisted(() => ({
  config: undefined as undefined | { projectType: string; capabilities?: string[] },
  typeCards: [] as Array<{ slug: string; name: string; description: string }>,
  typeListCalls: 0,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ to, role, children }: { to: string; role?: string; children?: ReactNode }) =>
      createElement('a', { href: to, role }, children),
    useNavigate: () => () => {},
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: '/' } }),
  };
});

// The config read (`GET /api/config`) as the server answers it for the
// project; the capability gate is the shell's own helper.
vi.mock('../hooks/useConfig.js', async () => {
  const { hasEntitiesCapability } = await import('../lib/capabilities.js');
  return {
    useRoots: () => [],
    useBaseRootId: () => null,
    useElementsMenuLayout: () => ({ ready: true, layout: undefined }),
    useConfig: () => ({ data: h.config }),
    useHasEntities: () => hasEntitiesCapability(h.config?.capabilities),
  };
});

vi.mock('../hooks/usePages.js', () => ({
  usePages: () => ({ data: [] }),
  useSidebarAccordions: () => ({ data: [], isSuccess: true }),
  usePagesSearch: () => ({ data: [], isFetching: false }),
}));
vi.mock('./UserSection.js', () => ({ UserSection: () => null }));
vi.mock('./GitStatusBadge.js', () => ({ GitStatusBadge: () => null }));
vi.mock('./ProjectSwitcher.js', () => ({
  ProjectSwitcher: () => createElement('div', { 'data-testid': 'project-switcher' }),
}));

import { Sidebar } from './Sidebar.js';
import { HOST_PROJECT_TYPE_ENTRIES } from '../../server/project-types/entries.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST_CARDS: ProjectTypeCard[] = HOST_PROJECT_TYPE_ENTRIES.map((e) => ({
  slug: e.slug,
  name: e.name,
  description: e.description,
}));

/** The project's config as the server derives it from its type. */
function projectOfType(slug: string): { projectType: string; capabilities: string[] } {
  const entry = HOST_PROJECT_TYPE_ENTRIES.find((e) => e.slug === slug);
  if (!entry) throw new Error(`no host type ${slug}`);
  return { projectType: slug, capabilities: [...entry.capabilities] };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.config = undefined;
  h.typeCards = HOST_CARDS;
  h.typeListCalls = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url) !== '/api/workspace/project-types') throw new Error(`unexpected fetch ${String(url)}`);
    h.typeListCalls += 1;
    return new Response(JSON.stringify({ types: h.typeCards }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(Sidebar, {
          width: 300,
          cwdPath: '/work/p',
          projectName: 'P',
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
  await flush();
}

/** The ELEMENTS section: its heading and its list. */
function elementsSection() {
  const aside = host.querySelector('aside')!;
  const heading = Array.from(aside.querySelectorAll('span')).find((s) => s.textContent === 'Elements') ?? null;
  return { heading, list: aside.querySelector('[data-elements-list]') };
}

/** Opens the OTHERS side menu and returns its items: label + route. */
async function othersItems(): Promise<Array<{ label: string; href: string }>> {
  const trigger = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')).find((b) =>
    b.textContent?.includes('OTHERS'),
  );
  expect(trigger).toBeDefined();
  await act(async () => {
    trigger!.click();
  });
  const menu = document.querySelector('[role="menu"][aria-label="Others"]');
  expect(menu).not.toBeNull();
  return Array.from(menu!.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')).map((a) => ({
    label: a.textContent ?? '',
    href: a.getAttribute('href') ?? '',
  }));
}

describe('M50 shell by project type — sidebar composition from capabilities', () => {
  it('[ac:m50-no-elements-without-entities] in a `skill` project the sidebar has no section headed `ELEMENTS` — no heading, no list, no "no types configured" message', async () => {
    h.config = projectOfType('skill');
    await renderSidebar();
    const { heading, list } = elementsSection();
    expect(heading).toBeNull();
    expect(list).toBeNull();
    expect(host.textContent).not.toContain('No entity types configured.');
    // The sidebar goes from the page-tree slot straight to the OTHERS link.
    expect(host.textContent).toContain('OTHERS');
  });

  it('[ac:m50-no-tags-in-others-without-entities] in a `skill` project the OTHERS section has no "Tags" item (neither in the menu nor a /tags route)', async () => {
    h.config = projectOfType('skill');
    await renderSidebar();
    const items = await othersItems();
    expect(items.map((i) => i.label)).not.toContain('Tags');
    expect(items.map((i) => i.href)).not.toContain('/tags');
  });

  it('[ac:ac-w-projekcie-typu-skill-sekcja-others] in a `skill` project the OTHERS section has no "Briefs" item — no link to the briefs list (/briefs)', async () => {
    h.config = projectOfType('skill');
    await renderSidebar();
    const items = await othersItems();
    expect(items.map((i) => i.label)).not.toContain('Briefs');
    expect(items.map((i) => i.href)).not.toContain('/briefs');
  });

  it('[ac:m50-others-order-in-skill-project] in a `skill` project the OTHERS section shows Plans, Releases, TODOs, Links in that order', async () => {
    h.config = projectOfType('skill');
    await renderSidebar();
    const items = await othersItems();
    expect(items).toEqual([
      { label: 'Plans', href: '/plans' },
      { label: 'Releases', href: '/releases' },
      { label: 'TODOs', href: '/todos' },
      { label: 'Links', href: '/links' },
    ]);
  });

  it('[ac:ac-projekt-typu-skill-nie-ma-karty-entit] a Skill project has neither the Entities card (ELEMENTS) nor Briefs in the side panel', async () => {
    h.config = projectOfType('skill');
    await renderSidebar();
    expect(elementsSection().heading).toBeNull();
    expect(elementsSection().list).toBeNull();
    const items = await othersItems();
    expect(items.map((i) => i.label)).not.toContain('Briefs');
  });

  it('[ac:ac-projekt-typu-writing-style-nie-ma-kar] a Writing Style project has neither the Entities card (ELEMENTS) nor Briefs in the side panel', async () => {
    h.config = projectOfType('writing-style');
    await renderSidebar();
    expect(elementsSection().heading).toBeNull();
    expect(elementsSection().list).toBeNull();
    const items = await othersItems();
    expect(items.map((i) => i.label)).not.toContain('Briefs');
    expect(items.map((i) => i.href)).not.toContain('/briefs');
  });

  it('[ac:ac-projekt-zarejestrowany-jako-specyfika] a project registered as Specification has, once activated, the Entities card (ELEMENTS) and Briefs in the side panel', async () => {
    h.config = projectOfType('spec');
    await renderSidebar();
    const { heading, list } = elementsSection();
    expect(heading).not.toBeNull();
    expect(list).not.toBeNull();
    const items = await othersItems();
    expect(items.map((i) => i.label)).toEqual(['Plans', 'Releases', 'TODOs', 'Tags', 'Links', 'Briefs']);
    expect(items.find((i) => i.label === 'Briefs')?.href).toBe('/briefs');
  });
});

describe('M50 shell by project type — the Branding strip carries no type (2.1.86)', () => {
  it('[ac:ac-naglowek-sidebara-na-trasie-projektu] the sidebar header on a project route shows no name of the current project\'s type, and the shell does not read the type list', async () => {
    for (const slug of ['spec', 'writing-style', 'skill']) {
      h.config = projectOfType(slug);
      h.typeListCalls = 0;
      await renderSidebar();
      const strip = host.querySelector('aside')!.firstElementChild as HTMLElement;
      // Branding, the Nagłówek entry and the settings cog — nothing else.
      expect(strip.querySelector('a[href="https://claude4spec.inharness.ai"]')).not.toBeNull();
      expect(strip.querySelector('[data-testid="project-switcher"]')).not.toBeNull();
      expect(strip.querySelector('button[aria-label="Open settings"]')).not.toBeNull();
      expect(host.querySelector('[data-project-type-label]')).toBeNull();
      const name = HOST_CARDS.find((c) => c.slug === slug)!.name;
      expect(strip.textContent).not.toContain(name);
      expect(h.typeListCalls).toBe(0);
      act(() => root.unmount());
      root = createRoot(host);
    }
  });
});
