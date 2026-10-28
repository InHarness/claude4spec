// @vitest-environment happy-dom
/**
 * 2.1.12 (M31 `h23797ko` Remove project — `#danger-zone`, `m31l5001` Okna).
 * Both actions go through `confirmDestructive` windows (`project-detach`,
 * `project-purge`) rendered by the host's `ConfirmLayer`; purge needs the
 * project name retyped exactly; a `409 PROJECT_BUSY` keeps the window open with
 * an error toast; on success the UI loads `/p/<redirectProjectId>/`, or `/`
 * (→ 302 `/welcome`) when the last project was removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const nav = vi.hoisted(() => ({ hrefs: [] as string[] }));
/** The workspace's kind as `GET /api/workspace` answers it (`useWorkspace`). */
const ws = vi.hoisted(() => ({ kind: 'registry' as 'registry' | 'home' }));
vi.mock('../../lib/document-nav.js', () => ({
  navigateDocument: (href: string) => {
    nav.hrefs.push(href);
  },
}));
vi.mock('../../hooks/useConfig.js', () => ({
  useConfig: () => ({ data: { name: 'alpha' } }),
}));
vi.mock('../../hooks/useWorkspace.js', () => ({
  useWorkspace: () => ({
    data: { name: 'default', kind: ws.kind, lastOpenedProject: 'alpha', projects: [] },
  }),
}));
vi.mock('../../lib/api-core.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api-core.js')>()),
  PROJECT_ID: 'alpha',
}));

import { DangerZoneElement } from './DangerZoneElement.js';
import { ConfirmLayer } from '../../ui/ConfirmModal.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let toasts: Array<{ variant: string; message: string }>;
let requests: Array<{ url: string; method: string }>;
let deleteAnswer: { status: number; body: unknown };
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => {
    root.render(createElement('div', null, createElement(DangerZoneElement), createElement(ConfirmLayer)));
  });
  await flush();
}

const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.click();
  });
  await flush();
};
const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
};
const confirmWindow = () => host.querySelector<HTMLElement>('[data-modal-kind]');
const nameInput = () => host.querySelector<HTMLInputElement>('input[placeholder="alpha"]');

beforeEach(() => {
  ws.kind = 'registry';
  nav.hrefs = [];
  toasts = [];
  requests = [];
  deleteAnswer = { status: 200, body: { projects: [], redirectProjectId: null } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), method: (init?.method ?? 'GET').toUpperCase() });
      return new Response(JSON.stringify(deleteAnswer.body), { status: deleteAnswer.status });
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

/** Open `project-purge`, retype the name, confirm. */
async function purge() {
  await click(button('Delete project and c4s data'));
  await typeInto(nameInput()!, 'alpha');
  await click(button('Delete data'));
}

describe('Danger zone — remove project (M31 h23797ko)', () => {
  it('[ac:ac-purge-ostatniego-projektu-workspace-u] purging the last project of the workspace (redirectProjectId null) sends the UI to `/`, the root that redirects to /welcome', async () => {
    await render();
    await purge();

    expect(requests).toEqual([{ url: '/api/workspace/projects/alpha?purgeData=true', method: 'DELETE' }]);
    // The last project is gone: no `/p/<id>/` — the root, which the server 302s to `/welcome`.
    expect(nav.hrefs).toEqual(['/']);
    expect(confirmWindow()).toBeNull();
    expect(toasts).toEqual([]);
  });

  it('[ac:ac-sekcja-danger-zone-w-settings-oferuje-d] the Danger zone offers two separate removals — Detach (purgeData=false, plain ConfirmModal) and Delete project and c4s data (purgeData=true, type-to-confirm modal) — each with its own confirmation window', async () => {
    await render();
    // Two distinct actions on the card.
    expect(button('Detach project')).not.toBeNull();
    expect(button('Delete project and c4s data')).not.toBeNull();

    // Detach: the plain confirmation — no text to retype, confirm enabled at once.
    await click(button('Detach project'));
    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('project-detach');
    expect(host.querySelector('input')).toBeNull();
    expect((button('Detach') as HTMLButtonElement).disabled).toBe(false);
    await click(button('Detach'));
    expect(requests).toEqual([{ url: '/api/workspace/projects/alpha?purgeData=false', method: 'DELETE' }]);

    // Purge: a different window — type-to-confirm on the project name.
    requests = [];
    await click(button('Delete project and c4s data'));
    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('project-purge');
    expect(nameInput()).not.toBeNull();
    expect((button('Delete data') as HTMLButtonElement).disabled).toBe(true);
    await typeInto(nameInput()!, 'alpha');
    await click(button('Delete data'));
    expect(requests).toEqual([{ url: '/api/workspace/projects/alpha?purgeData=true', method: 'DELETE' }]);
  });

  it('a purge that leaves other projects navigates to /p/<redirectProjectId>/', async () => {
    deleteAnswer = { status: 200, body: { projects: [{ id: 'beta' }], redirectProjectId: 'beta' } };
    await render();
    await purge();
    expect(nav.hrefs).toEqual(['/p/beta/']);
  });

  it('[section:m31l5001] project-detach in a registry workspace: a confirmation window with the spec text; [Detach] sends purgeData=false', async () => {
    await render();
    await click(button('Detach project'));

    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('project-detach');
    expect(confirmWindow()?.textContent).toBe(
      'Detach alpha from the workspace? c4s data (index, chats, plans, releases) stays on disk — registering the same directory again restores it.',
    );
    expect(button('Cancel')).not.toBeNull();
    expect(requests).toEqual([]);

    await click(button('Detach'));
    expect(requests).toEqual([{ url: '/api/workspace/projects/alpha?purgeData=false', method: 'DELETE' }]);
    expect(nav.hrefs).toEqual(['/']);
  });

  it('[section:m31l5001] project-detach in a workspace with a home directory: the text says the project leaves the committed workspace.json; [Detach] sends purgeData=false', async () => {
    ws.kind = 'home';
    await render();
    await click(button('Detach project'));

    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('project-detach');
    expect(confirmWindow()?.textContent).toBe(
      'Detach alpha from the workspace? The project leaves workspace.json — once committed, it disappears for everyone working on this repository. Restore it with git or by adding the project again.',
    );
    expect(confirmWindow()?.textContent).not.toContain('stays on disk');

    await click(button('Detach'));
    expect(requests).toEqual([{ url: '/api/workspace/projects/alpha?purgeData=false', method: 'DELETE' }]);
  });

  it('project-detach: [Cancel] closes the window without a request', async () => {
    await render();
    await click(button('Detach project'));
    await click(button('Cancel'));
    expect(confirmWindow()).toBeNull();
    expect(requests).toEqual([]);
  });

  it('project-purge: [Delete data] stays disabled until the project name is retyped exactly', async () => {
    await render();
    await click(button('Delete project and c4s data'));

    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('project-purge');
    expect(confirmWindow()?.textContent).toBe(
      'Chats, plans, releases and sessions of this project will be lost permanently. config.json, pages (pages/) and entities in the project directory stay untouched — registering it again recreates the project with an empty runtime and a fresh index.',
    );
    const confirm = button('Delete data') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await typeInto(nameInput()!, 'alph');
    expect((button('Delete data') as HTMLButtonElement).disabled).toBe(true);
    await click(button('Delete data'));
    expect(requests).toEqual([]);

    await typeInto(nameInput()!, 'alpha');
    expect((button('Delete data') as HTMLButtonElement).disabled).toBe(false);
  });

  it('project-purge refused with 409 PROJECT_BUSY: an error toast, the window stays open, no navigation', async () => {
    deleteAnswer = {
      status: 409,
      body: { error: { code: 'PROJECT_BUSY', message: 'project has an in-flight agent turn' } },
    };
    await render();
    await purge();

    expect(requests).toHaveLength(1);
    expect(toasts).toEqual([{ variant: 'error', message: 'Project is busy — finish the running turn first' }]);
    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('project-purge');
    expect(button('Delete data')).not.toBeNull();
    expect(nav.hrefs).toEqual([]);
  });
});
