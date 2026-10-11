// @vitest-environment happy-dom
/**
 * 2.1.12 (M31 `m31l5001` Okna — `project-create`). A path that does not exist
 * or that the server cannot read/write (ENOENT, EACCES — `GET /api/workspace/fs`
 * and `POST /api/workspace/projects` answer `400 VALIDATION`) is reported INLINE
 * in the window, not as a toast; the window stays open and nothing navigates.
 * The registry half (`POST` leaves it unchanged) is pinned server-side in
 * tests/integration/api/workspace-projects.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ModalRequest } from '../events.js';

const nav = vi.hoisted(() => ({ hrefs: [] as string[] }));
vi.mock('../../lib/document-nav.js', () => ({
  navigateDocument: (href: string) => {
    nav.hrefs.push(href);
  },
}));

import { ProjectCreate } from './ProjectCreate.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { status: number; body: unknown };

let host: HTMLDivElement;
let root: Root;
let toasts: Array<{ variant: string; message: string }>;
let requests: Array<{ url: string; method: string; body?: unknown }>;
let closed: unknown[];
let fsAnswer: Answer;
let postAnswer: Answer;
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);

const listing = { path: '/home/u', parent: '/home', entries: [{ name: 'repo', path: '/home/u/repo' }] };
const enoent = {
  status: 400,
  body: { error: { code: 'VALIDATION', message: 'directory does not exist: /home/u/nope' } },
};
const eacces = {
  status: 400,
  body: { error: { code: 'VALIDATION', message: 'no read/write permission for directory: /root/locked' } },
};

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  const request = {
    kind: 'project-create',
    props: {},
    onSubmit: () => {},
    onCancel: () => {},
  } as unknown as ModalRequest<'project-create'>;
  await act(async () => {
    root.render(createElement(ProjectCreate, { request, onClose: (r: unknown) => closed.push(r) }));
  });
  await flush();
}

const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;
const cwdInput = () => host.querySelector<HTMLInputElement>('input[placeholder="/absolute/path/to/project"]')!;
async function submitPath(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(cwdInput(), value);
    cwdInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
  const add = button('Add project');
  expect(add).not.toBeNull();
  await act(async () => {
    add!.click();
  });
  await flush();
}
const posts = () => requests.filter((r) => r.method === 'POST');

beforeEach(() => {
  nav.hrefs = [];
  toasts = [];
  requests = [];
  closed = [];
  fsAnswer = { status: 200, body: listing };
  postAnswer = { status: 201, body: { projectId: 'new-one' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const a = String(url).startsWith('/api/workspace/fs') ? fsAnswer : postAnswer;
      return new Response(JSON.stringify(a.body), { status: a.status });
    }),
  );
  window.addEventListener('c4s:toast', onToast);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener('c4s:toast', onToast);
  vi.unstubAllGlobals();
});

describe('project-create window — invalid path (M31 m31l5001)', () => {
  it('[ac:ac-dodanie-z-modala-sciezki-nieistniejac] a nonexistent or unreadable path shows the validation error inside the window, not as a toast', async () => {
    postAnswer = enoent;
    await render();

    // ENOENT on submit: the server's message, inline; no toast; the window stays open.
    await submitPath('/home/u/nope');
    expect(posts()).toEqual([{ url: '/api/workspace/projects', method: 'POST', body: { cwd: '/home/u/nope' } }]);
    expect(host.textContent).toContain('directory does not exist: /home/u/nope');
    expect(toasts).toEqual([]);
    expect(closed).toEqual([]);
    expect(cwdInput()).not.toBeNull();

    // EACCES on submit: same — inline, no toast.
    postAnswer = eacces;
    await submitPath('/root/locked');
    expect(host.textContent).toContain('no read/write permission for directory: /root/locked');
    expect(host.textContent).not.toContain('directory does not exist');
    expect(toasts).toEqual([]);
    expect(closed).toEqual([]);
  });

  it('[ac:ac-dodanie-z-modala-sciezki-nieistniejac] a directory the browser cannot list (GET /api/workspace/fs 400) is reported inline in the window, not as a toast', async () => {
    fsAnswer = {
      status: 400,
      body: { error: { code: 'VALIDATION', message: "EACCES: permission denied, scandir '/home/u'" } },
    };
    await render();
    expect(requests[0]).toMatchObject({ url: '/api/workspace/fs', method: 'GET' });
    expect(host.textContent).toContain("EACCES: permission denied, scandir '/home/u'");
    expect(toasts).toEqual([]);
    expect(closed).toEqual([]);
  });

  it('[ac:ac-dodanie-z-modala-sciezki-nieistniejac-2] a refused path leaves the workspace as it was: no navigation to a new project, no success toast, the window stays open for a correction', async () => {
    postAnswer = enoent;
    await render();
    await submitPath('/home/u/nope');
    postAnswer = eacces;
    await submitPath('/root/locked');

    expect(posts()).toHaveLength(2);
    expect(nav.hrefs).toEqual([]);
    expect(toasts.filter((t) => t.variant === 'success')).toEqual([]);
    expect(closed).toEqual([]);
    // The [Add project] action is live again — the refusal is not a pending state.
    expect((button('Add project') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a valid directory registers and loads the new project route', async () => {
    await render();
    await submitPath('/home/u/repo');
    expect(nav.hrefs).toEqual(['/p/new-one/']);
    expect(toasts).toEqual([{ variant: 'success', message: 'Project added to workspace' }]);
  });
});
