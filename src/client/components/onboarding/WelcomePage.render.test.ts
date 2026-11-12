// @vitest-environment happy-dom
/**
 * 2.1.12 (M31 ui-view `welcome-page`, `/welcome`). The workspace registry
 * screen: the workspace's projects listed neutrally, a click loads the
 * project's route, "Add project to workspace" navigates to `/create-project`
 * (2.1.77; the `project-create` window is gone); state `empty` (e.g. after purging the last project) — an empty list
 * and only the add action. 2.1.58: a workspace route — its kind, its frame and
 * its document are pinned in src/client/App.workspace-frame.render.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ hrefs: [] as string[] }));
vi.mock('../../lib/document-nav.js', () => ({
  navigateDocument: (href: string) => {
    nav.hrefs.push(href);
  },
}));

import { WelcomePage } from './WelcomePage.js';
import { UI_EVENTS } from '../../ui/events.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let workspace: unknown;
let requests: string[];
let modals: Array<{ kind: string }>;
/** `GET /api/workspace/project-types` — the registry in its order (2.1.86: by position). */
const TYPES = [
  { slug: 'spec', name: 'Specification', description: 'd' },
  { slug: 'writing-style', name: 'Writing Style', description: 'd' },
  { slug: 'skill', name: 'Skill', description: 'd' },
];
const onModal = (e: Event) => modals.push((e as CustomEvent).detail);

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root.render(createElement(QueryClientProvider, { client }, createElement(WelcomePage)));
  });
  await flush();
}

const buttons = () => Array.from(host.querySelectorAll('button'));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label) ?? null;

beforeEach(() => {
  nav.hrefs = [];
  requests = [];
  modals = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      if (String(url) === '/api/workspace/project-types') {
        return new Response(JSON.stringify({ types: TYPES }), { status: 200 });
      }
      return new Response(JSON.stringify(workspace), { status: 200 });
    }),
  );
  window.addEventListener(UI_EVENTS.MODAL, onModal);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(UI_EVENTS.MODAL, onModal);
  vi.unstubAllGlobals();
});

describe('welcome-page (/welcome)', () => {
  it('[entity:welcome-page] default state: lists the workspace projects neutrally; a click loads /p/<id>/; "Add project to workspace" navigates to /create-project', async () => {
    workspace = {
      name: 'default',
      kind: 'registry',
      lastOpenedProject: null,
      projects: [
        { id: 'alpha', name: 'Alpha', cwd: '/work/alpha', live: true, projectType: 'spec', projectTypeName: 'Specification' },
        { id: 'beta', name: 'Beta', cwd: '/work/beta', live: false, projectType: 'spec', projectTypeName: 'Specification' },
      ],
    };
    await render();

    // 2.1.86: the type list orders and names the groups.
    expect([...requests].sort()).toEqual(['/api/workspace', '/api/workspace/project-types']);
    expect(host.textContent).toContain('Welcome to claude4spec');
    expect(host.textContent).toContain('default');
    const projectButtons = buttons().filter((b) => b.textContent?.includes('/work/'));
    expect(projectButtons.map((b) => b.textContent)).toEqual(['Alpha/work/alphaSpecification', 'Beta/work/betaSpecification']);
    // Neutral: no project is marked (no check mark, no accent difference by cwd).
    expect(projectButtons[0]!.outerHTML.replace(/alpha|Alpha/g, 'x')).toBe(
      projectButtons[1]!.outerHTML.replace(/beta|Beta/g, 'x'),
    );
    expect(host.textContent).not.toContain('No projects registered yet');

    await act(async () => {
      projectButtons[1]!.click();
    });
    expect(nav.hrefs).toEqual(['/p/beta/']);

    await act(async () => {
      button('Add project to workspace')!.click();
    });
    expect(nav.hrefs).toEqual(['/p/beta/', '/create-project']);
    expect(modals).toEqual([]);
  });

  it('[entity:welcome-page] state `empty`: the workspace registry has no project — an empty list and only the add-project action', async () => {
    workspace = { name: 'default', kind: 'registry', lastOpenedProject: null, projects: [] };
    await render();

    expect(host.textContent).toContain('No projects registered yet — add a directory below.');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Add project to workspace']);

    await act(async () => {
      button('Add project to workspace')!.click();
    });
    expect(modals).toEqual([]);
    expect(nav.hrefs).toEqual(['/create-project']);
  });

  it('[ac:ac-lista-projektow-na-welcome-nie-wyrozn] the project list on /welcome marks no project — not the one in the directory the server was started in, not the last opened one', async () => {
    // `alpha` lives in the directory the process was started in and is the
    // workspace's last opened project; the screen must not tell it apart.
    workspace = {
      name: 'default',
      kind: 'home',
      lastOpenedProject: 'alpha',
      projects: [
        { id: 'alpha', name: 'Alpha', cwd: '/work/alpha', live: true, projectType: 'spec', projectTypeName: 'Specification' },
        { id: 'beta', name: 'Beta', cwd: '/work/beta', live: false, projectType: 'spec', projectTypeName: 'Specification' },
      ],
    };
    await render();

    const rows = buttons().filter((b) => b.textContent?.includes('/work/'));
    expect(rows).toHaveLength(2);
    // Same markup for both rows once name and directory are masked: no mark,
    // no accent, no selection state.
    expect(rows[0]!.outerHTML.replace(/alpha|Alpha/g, 'x')).toBe(rows[1]!.outerHTML.replace(/beta|Beta/g, 'x'));
    for (const row of rows) {
      expect(row.getAttribute('aria-current')).toBeNull();
      expect(row.getAttribute('aria-selected')).toBeNull();
    }
    // In list order, as the registry answers — the start directory's project is not moved up.
    expect(rows.map((b) => b.textContent)).toEqual(['Alpha/work/alphaSpecification', 'Beta/work/betaSpecification']);
  });

  it('[ac:ac-przycisk-add-project-to-workspace-na] the "Add project to workspace" button on /welcome navigates to /create-project', async () => {
    workspace = {
      name: 'default',
      kind: 'registry',
      lastOpenedProject: null,
      projects: [{ id: 'alpha', name: 'Alpha', cwd: '/work/alpha', live: true, projectType: 'spec', projectTypeName: 'Specification' }],
    };
    await render();
    await act(async () => {
      button('Add project to workspace')!.click();
    });
    expect(nav.hrefs).toEqual(['/create-project']);
    // No window opens: the old add-project modal is gone.
    expect(modals).toEqual([]);
  });

  it('[ac:m31-welcome-row-shows-type-name] a project row on /welcome shows the name of that project\'s type', async () => {
    workspace = {
      name: 'default',
      kind: 'registry',
      lastOpenedProject: null,
      projects: [
        { id: 'app', name: 'App', cwd: '/work/app', live: true, projectType: 'spec', projectTypeName: 'Specification' },
        { id: 'review', name: 'Review', cwd: '/work/review', live: true, projectType: 'skill', projectTypeName: 'Skill' },
      ],
    };
    await render();
    const types = Array.from(host.querySelectorAll('[data-testid="project-type"]')).map((e) => e.textContent);
    expect(types).toEqual(['Specification', 'Skill']);
    const review = buttons().find((b) => b.textContent?.includes('Review'))!;
    expect(review.textContent).toContain('Skill');
    expect(review.textContent).not.toContain('skill');
    expect(review.disabled).toBe(false);
    await act(async () => {
      review.click();
    });
    expect(nav.hrefs).toEqual(['/p/review/']);
  });

  it('[ac:m31-welcome-unknown-type-row-unavailable] [ac:ac-projekt-z-nieznana-wartoscia-projectt-2] a project whose type the current version does not know is an unavailable row on /welcome, its type slug written out as is, and a click on it does not navigate', async () => {
    workspace = {
      name: 'default',
      kind: 'registry',
      lastOpenedProject: null,
      projects: [
        { id: 'app', name: 'App', cwd: '/work/app', live: true, projectType: 'spec', projectTypeName: 'Specification' },
        { id: 'future', name: 'Future', cwd: '/work/future', live: false, projectType: 'novel-kind', projectTypeName: null },
      ],
    };
    await render();
    const row = buttons().find((b) => b.textContent?.includes('Future'))!;
    // Still on the list…
    expect(row).toBeDefined();
    // …as an unavailable row…
    expect(row.disabled).toBe(true);
    expect(row.getAttribute('aria-disabled')).toBe('true');
    // …with the type slug written out literally.
    expect(row.querySelector('[data-testid="project-type"]')!.textContent).toBe('novel-kind');
    await act(async () => {
      row.click();
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(nav.hrefs).toEqual([]);
    // The known row next to it stays available.
    expect(buttons().find((b) => b.textContent?.includes('App'))!.disabled).toBe(false);
  });

  const project = (id: string, projectType: string, projectTypeName: string | null) => ({
    id,
    name: id.toUpperCase(),
    cwd: `/work/${id}`,
    live: true,
    projectType,
    projectTypeName,
  });
  const groups = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[data-project-type-group]')).map((g) => [
      g.querySelector('[data-testid="project-type-group-header"]')?.textContent ?? null,
      Array.from(g.querySelectorAll('button')).map((b) => b.querySelector('.font-medium')?.textContent),
    ]);

  it('[ac:ac-lista-projektow-na-welcome-jest-podzi] the list is split into type groups in the order of GET /api/workspace/project-types, each headed by the type name', async () => {
    workspace = {
      name: 'default',
      kind: 'registry',
      lastOpenedProject: null,
      projects: [
        project('s1', 'skill', 'Skill'),
        project('a1', 'spec', 'Specification'),
        project('w1', 'writing-style', 'Writing Style'),
        project('a2', 'spec', 'Specification'),
      ],
    };
    await render();
    expect(groups()).toEqual([
      ['Specification', ['A1', 'A2']],
      ['Writing Style', ['W1']],
      ['Skill', ['S1']],
    ]);
  });

  it('[ac:ac-typ-ktory-nie-ma-zadnego-projektu-w-w] a type with no project in the workspace has no group on /welcome', async () => {
    workspace = {
      name: 'default',
      kind: 'registry',
      lastOpenedProject: null,
      projects: [project('a1', 'spec', 'Specification'), project('s1', 'skill', 'Skill')],
    };
    await render();
    expect(groups().map(([header]) => header)).toEqual(['Specification', 'Skill']);
    expect(host.textContent).not.toContain('Writing Style');
  });

  it('[ac:ac-projekt-o-typie-nieznanym-biezacej-we] a project of a type the current version does not know stands in a group after the known ones, headed by its slug; several unknown slugs give several groups, alphabetically', async () => {
    workspace = {
      name: 'default',
      kind: 'registry',
      lastOpenedProject: null,
      projects: [
        project('z1', 'zeta-kind', null),
        project('a1', 'spec', 'Specification'),
        project('n1', 'novel-kind', null),
        project('s1', 'skill', 'Skill'),
      ],
    };
    await render();
    expect(groups()).toEqual([
      ['Specification', ['A1']],
      ['Skill', ['S1']],
      ['novel-kind', ['N1']],
      ['zeta-kind', ['Z1']],
    ]);
    const unknownRow = host.querySelector<HTMLButtonElement>('[data-project-type-group="novel-kind"] button')!;
    expect(unknownRow.disabled).toBe(true);
  });
});
