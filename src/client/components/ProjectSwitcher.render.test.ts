// @vitest-environment happy-dom
/**
 * M31 workspace switcher — a large workspace must not push projects (or the
 * "Add project to workspace" action) past the bottom of the viewport. The popover is
 * height-bounded; only the project list scrolls, the header and "Add project to workspace"
 * stay pinned outside it, and the current project is scrolled into view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../lib/api-core.js', () => ({ PROJECT_ID: 'p-25' }));
vi.mock('../ui/events.js', () => ({ openModal: vi.fn(), toast: { error: vi.fn() } }));
const nav = vi.hoisted(() => ({ hrefs: [] as string[] }));
vi.mock('../lib/document-nav.js', () => ({
  navigateDocument: (href: string) => {
    nav.hrefs.push(href);
  },
}));

import { ProjectSwitcher } from './ProjectSwitcher.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projects = Array.from({ length: 30 }, (_, i) => ({
  id: `p-${i}`,
  name: `Project ${i}`,
  cwd: `/work/project-${i}`,
  live: true,
  projectType: 'spec',
  projectTypeName: 'Specification' as string | null,
}));
/** `GET /api/workspace/project-types` — the registry in its order (2.1.86: by position). */
const TYPES = [
  { slug: 'spec', name: 'Specification', description: 'd' },
  { slug: 'writing-style', name: 'Writing Style', description: 'd' },
  { slug: 'skill', name: 'Skill', description: 'd' },
];
let workspaceProjects: typeof projects;

let host: HTMLDivElement;
let root: Root;
let scrolled: Element[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  nav.hrefs = [];
  scrolled = [];
  workspaceProjects = projects;
  fetchMock = vi.fn(async (url: string) =>
    String(url) === '/api/workspace/project-types'
      ? new Response(JSON.stringify({ types: TYPES }), { status: 200 })
      : new Response(JSON.stringify({ name: 'default', projects: workspaceProjects }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
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
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderSwitcher() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(ProjectSwitcher, { projectName: 'Project 25', cwdPath: '/work/project-25' }),
      ),
    );
  });
}

async function clickToggle() {
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Switch project"]')!.click();
  });
  // Let the shared /api/workspace query resolve and the list render.
  await flush();
}

async function openSwitcher() {
  await renderSwitcher();
  await clickToggle();
}

describe('ProjectSwitcher — large workspace', () => {
  it('bounds the popover height and scrolls only the project list', async () => {
    await openSwitcher();

    const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(listbox.style.maxHeight).not.toBe('');

    const list = host.querySelector<HTMLElement>('[data-testid="project-switcher-list"]')!;
    expect(list.className).toContain('overflow-y-auto');
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(30);
  });

  it('keeps "Add project to workspace" outside the scrolling list', async () => {
    await openSwitcher();

    const list = host.querySelector<HTMLElement>('[data-testid="project-switcher-list"]')!;
    const add = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Add project'))!;
    expect(add).toBeTruthy();
    expect(list.contains(add)).toBe(false);
  });

  it('scrolls the current project into view on open', async () => {
    await openSwitcher();

    const current = host.querySelector('[role="option"][aria-selected="true"]')!;
    expect(current.textContent).toContain('Project 25');
    expect(scrolled).toContain(current);
  });

  it('reads the list through the shared workspace query only when opened, and refreshes it on every open', async () => {
    await renderSwitcher();
    await flush();
    // Closed: no workspace read on mount.
    expect(fetchMock).not.toHaveBeenCalled();

    const workspaceReads = () => fetchMock.mock.calls.filter(([url]) => url === '/api/workspace').length;
    await clickToggle();
    expect(workspaceReads()).toBe(1);
    // 2.1.86: the type list, for the groups, is read with it.
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(['/api/workspace', '/api/workspace/project-types']);

    await clickToggle(); // close
    await clickToggle(); // reopen → the stale shared entry is refetched
    expect(workspaceReads()).toBe(2);
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(30);
  });
});

describe('ProjectSwitcher — Add project to workspace (M31 `m31l5001` Sloty)', () => {
  it('[ac:m31-switcher-add-project-navigates-to-create-project] the switcher action "Add project to workspace" navigates from the project route to /create-project with a document reload', async () => {
    const events = await import('../ui/events.js');
    await openSwitcher();
    const add = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Add project to workspace',
    );
    expect(add).toBeDefined();
    await act(async () => {
      add!.click();
    });
    // A document load of the workspace route (outside /p/<id>/), not a window.
    expect(nav.hrefs).toEqual(['/create-project']);
    expect(events.openModal).not.toHaveBeenCalled();
    // The popover closes behind the navigation.
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('ProjectSwitcher — grouped by project type (M31, 2.1.86)', () => {
  const project = (id: string, projectType: string, projectTypeName: string | null) => ({
    id,
    name: id.toUpperCase(),
    cwd: `/work/${id}`,
    live: true,
    projectType,
    projectTypeName,
  });
  const groups = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[role="listbox"] [data-project-type-group]')).map((g) => [
      g.querySelector('[data-testid="project-type-group-header"]')?.textContent ?? null,
      Array.from(g.querySelectorAll('[role="option"]')).map((o) => o.querySelector('.font-medium')?.textContent),
    ]);

  it('[ac:ac-lista-rozwijana-przelacznika-projektu] the dropdown is split into type groups in the order of GET /api/workspace/project-types, each headed by the type name', async () => {
    workspaceProjects = [
      project('s1', 'skill', 'Skill'),
      project('p-25', 'spec', 'Specification'),
      project('w1', 'writing-style', 'Writing Style'),
      project('a2', 'spec', 'Specification'),
    ];
    await openSwitcher();
    expect(groups()).toEqual([
      ['Specification', ['P-25', 'A2']],
      ['Writing Style', ['W1']],
      ['Skill', ['S1']],
    ]);
  });

  it('[ac:ac-typ-ktory-nie-ma-zadnego-projektu-w-w-2] a type with no project in the workspace has no group in the dropdown', async () => {
    workspaceProjects = [project('p-25', 'spec', 'Specification'), project('s1', 'skill', 'Skill')];
    await openSwitcher();
    expect(groups().map(([header]) => header)).toEqual(['Specification', 'Skill']);
    expect(host.querySelector('[role="listbox"]')!.textContent).not.toContain('Writing Style');
  });

  it('[ac:ac-projekt-o-typie-nieznanym-biezacej-we-2] a project of an unknown type stands in a group after the known ones, headed by its slug, and cannot be picked; several unknown slugs give several groups, alphabetically', async () => {
    workspaceProjects = [
      project('z1', 'zeta-kind', null),
      project('p-25', 'spec', 'Specification'),
      project('n1', 'novel-kind', null),
    ];
    await openSwitcher();
    expect(groups()).toEqual([
      ['Specification', ['P-25']],
      ['novel-kind', ['N1']],
      ['zeta-kind', ['Z1']],
    ]);
    const unknown = host.querySelector<HTMLButtonElement>('[data-project-type-group="novel-kind"] [role="option"]')!;
    expect(unknown.disabled).toBe(true);
    expect(unknown.getAttribute('aria-disabled')).toBe('true');
    expect(unknown.textContent).toContain('novel-kind');
    const before = window.location.href;
    await act(async () => {
      unknown.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(window.location.href).toBe(before);
    // The popover stays open — nothing was picked.
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  });
});
