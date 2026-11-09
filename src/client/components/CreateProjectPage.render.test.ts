// @vitest-environment happy-dom
/**
 * 2.1.77 (M31 ui-view `create-project-page`, `/create-project`). The page that
 * replaces the `project-create` window: two paths — `New project` (type cards
 * from `GET /api/workspace/project-types` in registry order, a required choice,
 * then the directory list; `Create project` posts the directory and the slug)
 * and `Add existing directory` (the list only; `Add project` posts the directory
 * alone). Its states: `types-loading`, `types-error`, `directory-error`,
 * `wrong-path`, `submitting`. Server side of the registration — the registry
 * left unchanged by a refusal — is pinned in
 * tests/integration/api/workspace-projects.test.ts and
 * src/server/routes/workspace-project-type.route.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ hrefs: [] as string[] }));
vi.mock('../lib/document-nav.js', () => ({
  navigateDocument: (href: string) => {
    nav.hrefs.push(href);
  },
}));

import { CreateProjectPage } from './CreateProjectPage.js';
import { BASE_ROUTE_CHILDREN } from '../router.js';
import { needsOnboarding } from './onboarding/onboardingFlow.js';
import { UI_EVENTS } from '../ui/events.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { status: number; body: unknown };

const TYPES = [
  { slug: 'spec', name: 'Specification', description: 'Pages and entities of a product specification.' },
  { slug: 'skill', name: 'Skill', description: 'One agent skill package.' },
  { slug: 'writing-style', name: 'Writing Style', description: 'One writing style.' },
];
const listing = {
  path: '/home/u',
  parent: '/home',
  entries: [
    { name: 'fresh', path: '/home/u/fresh' },
    { name: 'repo', path: '/home/u/repo' },
  ],
};
const listingOf = (p: string) => ({ path: p, parent: '/home/u', entries: [] });

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ url: string; method: string; body?: unknown }>;
let toasts: unknown[];
let typesAnswer: Answer | (() => Promise<Answer>);
let fsAnswer: (url: string) => Answer;
let postAnswer: Answer | (() => Promise<Answer>);
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(CreateProjectPage)));
  });
  await flush();
}

const buttons = () => Array.from(host.querySelectorAll('button'));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label) ?? null;
const tab = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.trim() === label)!;
const cards = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
const card = (name: string) => cards().find((c) => c.textContent?.includes(name))!;
const posts = () => requests.filter((r) => r.method === 'POST');
const selectedDir = () => host.querySelector('[data-testid="directory-list-path"]')!.textContent;
const dirErrors = () => Array.from(host.querySelectorAll('[data-testid="directory-list-error"]')).map((e) => e.textContent);

async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.click();
  });
  await flush();
}

/** Drill into a folder of the directory list (the selection is the browsed folder). */
async function enter(name: string) {
  await click(buttons().find((b) => b.textContent?.trim() === name) ?? null);
}

async function resolveAnswer(a: Answer | (() => Promise<Answer>)): Promise<Answer> {
  return typeof a === 'function' ? a() : a;
}

beforeEach(() => {
  nav.hrefs = [];
  requests = [];
  toasts = [];
  typesAnswer = { status: 200, body: { types: TYPES } };
  fsAnswer = (url) => {
    const m = url.match(/\?path=(.*)$/);
    return { status: 200, body: m ? listingOf(decodeURIComponent(m[1]!)) : listing };
  };
  postAnswer = { status: 201, body: { projectId: 'fresh' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      let a: Answer;
      if (String(url).startsWith('/api/workspace/project-types')) a = await resolveAnswer(typesAnswer);
      else if (String(url).startsWith('/api/workspace/fs')) a = fsAnswer(String(url));
      else a = await resolveAnswer(postAnswer);
      return new Response(JSON.stringify(a.body), { status: a.status });
    }),
  );
  window.addEventListener(UI_EVENTS.TOAST, onToast);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(UI_EVENTS.TOAST, onToast);
  vi.unstubAllGlobals();
});

describe('create-project-page (/create-project)', () => {
  it('[entity:create-project-page] a workspace route at /create-project, titled `Create project`, two paths with `New project` as default; New project shows the type cards then the directory list (server start: no `path`), Add existing directory the list only', async () => {
    const route = BASE_ROUTE_CHILDREN.find((r) => (r.options as { path?: string }).path === '/create-project');
    expect(route).toBeDefined();
    expect(route!.options.staticData).toEqual({ routeKind: 'workspace' });
    expect(route!.options.staticData?.fullscreen).toBeUndefined();

    await render();
    expect(host.querySelector('h1')!.textContent).toBe('Create project');
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual([
      'New project',
      'Add existing directory',
    ]);
    expect(tab('New project').getAttribute('aria-selected')).toBe('true');
    // Step 1 then step 2 on New project; the list started where the server says.
    expect(host.querySelector('[data-testid="project-type-step"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="directory-step"]')).not.toBeNull();
    expect(requests.some((r) => r.url === '/api/workspace/fs')).toBe(true);
    expect(selectedDir()).toBe('/home/u');
    // Each card shows the type's name and its description for the user.
    expect(card('Skill').textContent).toBe('SkillOne agent skill package.');
    expect(button('Create project')).not.toBeNull();

    await click(tab('Add existing directory'));
    expect(host.querySelector('[data-testid="project-type-step"]')).toBeNull();
    expect(host.querySelector('[data-testid="directory-step"]')).not.toBeNull();
    expect(button('Add project')).not.toBeNull();
    expect(button('Create project')).toBeNull();
  });

  it('[ac:m31-create-project-type-cards-registry-order] New project shows one card per type of GET /api/workspace/project-types, in that answer\'s order', async () => {
    // An order that is not alphabetical, to tell registry order from sorting.
    typesAnswer = { status: 200, body: { types: [TYPES[2], TYPES[0], TYPES[1]] } };
    await render();
    expect(requests.filter((r) => r.url === '/api/workspace/project-types')).toHaveLength(1);
    expect(cards().map((c) => c.getAttribute('data-slug'))).toEqual(['writing-style', 'spec', 'skill']);
    expect(cards().map((c) => c.querySelector('span')!.textContent)).toEqual(['Writing Style', 'Specification', 'Skill']);
  });

  it('[ac:m31-create-project-requires-type-choice] on New project the `Create project` button stays disabled until a type card is chosen', async () => {
    await render();
    // A directory is selected (the browsed folder) but no type yet.
    await enter('fresh');
    expect(selectedDir()).toBe('/home/u/fresh');
    expect(cards().every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(button('Create project')!.disabled).toBe(true);
    await click(button('Create project'));
    expect(posts()).toEqual([]);

    await click(card('Skill'));
    expect(card('Skill').getAttribute('aria-checked')).toBe('true');
    expect(button('Create project')!.disabled).toBe(false);
  });

  it('[ac:ac-katalog-wskazany-w-modalu-welcome-i-z] [ac:ac-po-udanym-dodaniu-projektu-z-modala-w] the directory picked on /create-project is sent to POST /api/workspace/projects (with the chosen type on New project, alone on Add existing directory) and a success loads /p/<project-id>/ of the added project', async () => {
    await render();
    await click(card('Specification'));
    await enter('fresh');
    await click(button('Create project'));
    expect(posts()).toEqual([
      { url: '/api/workspace/projects', method: 'POST', body: { cwd: '/home/u/fresh', projectType: 'spec' } },
    ]);
    expect(nav.hrefs).toEqual(['/p/fresh/']);

    // The existing-directory path posts the directory alone.
    act(() => root.unmount());
    root = createRoot(host);
    requests = [];
    nav.hrefs = [];
    postAnswer = { status: 201, body: { projectId: 'repo' } };
    await render();
    await click(tab('Add existing directory'));
    await enter('repo');
    await click(button('Add project'));
    expect(posts()).toEqual([{ url: '/api/workspace/projects', method: 'POST', body: { cwd: '/home/u/repo' } }]);
    expect(nav.hrefs).toEqual(['/p/repo/']);
  });

  it('[ac:ac-swiezy-katalog-dodany-z-modala-welcom] a project created on the New project path ends on /onboarding: the page loads the new project\'s route, whose fresh config sends it to the onboarding route', async () => {
    await render();
    await click(card('Specification'));
    await enter('fresh');
    await click(button('Create project'));
    expect(posts()[0]!.body).toEqual({ cwd: '/home/u/fresh', projectType: 'spec' });
    expect(nav.hrefs).toEqual(['/p/fresh/']);
    // The project route's landing: a project whose onboarding is not completed
    // (a fresh registration writes `onboardingCompleted: false`, pinned in
    // workspace-project-type.route.test.ts) is redirected to /onboarding.
    const onboarding = BASE_ROUTE_CHILDREN.find((r) => (r.options as { path?: string }).path === '/onboarding')!;
    const redirectIf = (onboarding.options.staticData as { redirectIf?: typeof needsOnboarding }).redirectIf!;
    expect(redirectIf).toBe(needsOnboarding);
    expect(redirectIf({ onboarding: { completed: false } } as Parameters<typeof needsOnboarding>[0])).toBe(true);
  });

  it('[ac:ac-dodanie-z-modala-sciezki-nieistniejac] [entity:create-project-page] state `directory-error`: a nonexistent or unreadable path is shown inline under the directory list, not as a toast, and the type choice stays', async () => {
    await render();
    await click(card('Skill'));
    // The listing refuses a path (ENOENT).
    fsAnswer = (url) =>
      url.includes('?path=')
        ? { status: 400, body: { error: { code: 'VALIDATION', message: 'directory does not exist: /home/u/fresh' } } }
        : { status: 200, body: listing };
    await enter('fresh');
    expect(dirErrors()).toEqual(['directory does not exist: /home/u/fresh']);
    const list = host.querySelector('[data-testid="directory-list"]')!;
    // Under the list: after the bordered listing box, inside the list component.
    expect(list.lastElementChild!.getAttribute('data-testid')).toBe('directory-list-error');
    expect(toasts).toEqual([]);
    expect(card('Skill').getAttribute('aria-checked')).toBe('true');

    // The registration refuses a path it cannot read/write (EACCES → 400 VALIDATION).
    fsAnswer = (url) => ({ status: 200, body: url.includes('?path=') ? listingOf('/home/u/repo') : listing });
    await enter('repo');
    expect(dirErrors()).toEqual([]);
    postAnswer = { status: 400, body: { error: { code: 'VALIDATION', message: 'no read/write permission for directory: /home/u/repo' } } };
    await click(button('Create project'));
    expect(dirErrors()).toEqual(['no read/write permission for directory: /home/u/repo']);
    expect(toasts).toEqual([]);
    expect(card('Skill').getAttribute('aria-checked')).toBe('true');
  });

  it('[entity:create-project-page] state `directory-error`: the home-workspace refusals PROJECT_PATH_OUTSIDE_HOME / PROJECT_PATH_IS_HOME stand inline under the list', async () => {
    await render();
    await click(tab('Add existing directory'));
    for (const code of ['PROJECT_PATH_OUTSIDE_HOME', 'PROJECT_PATH_IS_HOME']) {
      postAnswer = { status: 400, body: { error: { code, message: `${code} message` } } };
      await click(button('Add project'));
      expect(dirErrors()).toEqual([`${code} message`]);
    }
    expect(toasts).toEqual([]);
    expect(nav.hrefs).toEqual([]);
  });

  it('[ac:ac-dodanie-z-modala-sciezki-nieistniejac-2] a refused path on /create-project leaves the workspace as it was: nothing navigates to a new project, no success toast, the page stays for a correction', async () => {
    await render();
    await click(tab('Add existing directory'));
    await enter('fresh');
    postAnswer = { status: 400, body: { error: { code: 'VALIDATION', message: 'directory does not exist: /home/u/fresh' } } };
    await click(button('Add project'));
    expect(posts()).toHaveLength(1);
    expect(nav.hrefs).toEqual([]);
    expect(toasts).toEqual([]);
    // Still on the page, the button usable again for a corrected choice.
    expect(button('Add project')!.disabled).toBe(false);
  });

  it('[entity:create-project-page] state `types-loading`: while the type list has not arrived, New project shows a loading state in place of the cards and `Create project` is disabled', async () => {
    let release!: (a: Answer) => void;
    typesAnswer = () => new Promise<Answer>((r) => (release = r));
    await render();
    expect(host.querySelector('[data-testid="types-loading"]')).not.toBeNull();
    expect(cards()).toEqual([]);
    expect(button('Create project')!.disabled).toBe(true);
    await act(async () => release({ status: 200, body: { types: TYPES } }));
    await flush();
    expect(host.querySelector('[data-testid="types-loading"]')).toBeNull();
    expect(cards()).toHaveLength(3);
  });

  it('[entity:create-project-page] state `types-error`: New project shows an error with a retry; a retry asks for the list again', async () => {
    typesAnswer = { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } };
    await render();
    const error = host.querySelector('[data-testid="types-error"]')!;
    expect(error.textContent).toContain('Could not load project types.');
    expect(button('Create project')!.disabled).toBe(true);
    typesAnswer = { status: 200, body: { types: TYPES } };
    await click(button('Retry'));
    expect(requests.filter((r) => r.url === '/api/workspace/project-types')).toHaveLength(2);
    expect(cards()).toHaveLength(3);
  });

  it('[ac:m31-types-error-keeps-existing-path] when the type list cannot be fetched, Add existing directory on /create-project still registers the project', async () => {
    typesAnswer = { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } };
    postAnswer = { status: 201, body: { projectId: 'repo' } };
    await render();
    expect(host.querySelector('[data-testid="types-error"]')).not.toBeNull();
    await click(tab('Add existing directory'));
    await enter('repo');
    expect(button('Add project')!.disabled).toBe(false);
    await click(button('Add project'));
    expect(posts()).toEqual([{ url: '/api/workspace/projects', method: 'POST', body: { cwd: '/home/u/repo' } }]);
    expect(nav.hrefs).toEqual(['/p/repo/']);
  });

  it('[ac:m31-wrong-path-offers-switch-keeping-directory] [entity:create-project-page] state `wrong-path`: after a refusal of a directory that does not fit the path, the page offers a switch to the other path, after which the chosen directory stays selected', async () => {
    await render();
    await click(card('Skill'));
    await enter('repo');
    postAnswer = { status: 400, body: { error: { code: 'PROJECT_PATH_ALREADY_INITIALIZED', message: 'has config.json' } } };
    await click(button('Create project'));
    const notice = host.querySelector('[data-testid="wrong-path"]')!;
    expect(notice.textContent).toContain('This directory is already a project. Add it as an existing directory.');
    expect(toasts).toEqual([]);
    const fsCalls = requests.filter((r) => r.url.startsWith('/api/workspace/fs')).length;

    await click(notice.querySelector('button'));
    expect(tab('Add existing directory').getAttribute('aria-selected')).toBe('true');
    // The directory is kept: same selection, no new listing from the start.
    expect(selectedDir()).toBe('/home/u/repo');
    expect(requests.filter((r) => r.url.startsWith('/api/workspace/fs')).length).toBe(fsCalls);
    expect(host.querySelector('[data-testid="wrong-path"]')).toBeNull();
    postAnswer = { status: 201, body: { projectId: 'repo' } };
    await click(button('Add project'));
    expect(posts().at(-1)!.body).toEqual({ cwd: '/home/u/repo' });

    // The other way round: Add existing directory over a directory without config.json.
    act(() => root.unmount());
    root = createRoot(host);
    requests = [];
    await render();
    await click(tab('Add existing directory'));
    await enter('fresh');
    postAnswer = { status: 400, body: { error: { code: 'PROJECT_PATH_NOT_INITIALIZED', message: 'no config.json' } } };
    await click(button('Add project'));
    const back = host.querySelector('[data-testid="wrong-path"]')!;
    expect(back.textContent).toContain('This directory is not a project yet. Create a new project in it.');
    await click(back.querySelector('button'));
    expect(tab('New project').getAttribute('aria-selected')).toBe('true');
    expect(selectedDir()).toBe('/home/u/fresh');
  });

  it('[entity:create-project-page] state `submitting`: while the registration is in flight the submit button is disabled and shows progress, and the type and directory choice are locked', async () => {
    let release!: (a: Answer) => void;
    postAnswer = () => new Promise<Answer>((r) => (release = r));
    await render();
    await click(card('Specification'));
    await enter('fresh');
    await act(async () => {
      button('Create project')!.click();
    });
    await flush();
    const submit = button('Creating…')!;
    expect(submit).not.toBeNull();
    expect(submit.disabled).toBe(true);
    expect(cards().every((c) => c.disabled)).toBe(true);
    const dirButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="directory-list"] button'));
    expect(dirButtons.length).toBeGreaterThan(0);
    expect(dirButtons.every((b) => b.disabled)).toBe(true);
    // The path switch does not move either.
    await click(tab('Add existing directory'));
    expect(tab('New project').getAttribute('aria-selected')).toBe('true');
    await act(async () => release({ status: 201, body: { projectId: 'fresh' } }));
    await flush();
    expect(nav.hrefs).toEqual(['/p/fresh/']);
  });
});
