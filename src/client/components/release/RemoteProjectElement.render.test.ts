// @vitest-environment happy-dom
/**
 * M26 `#remote-project` card (ui-view `settings-page`, M25 edge cases).
 *
 * The card reads the local proxy `GET /api/remote-project` and edits through
 * `PATCH /api/remote-project`; both are stubbed at fetch — the proxy's own
 * mapping of the remote service (404 → `reason: 'not_found'`, 403 → `NOT_OWNER`,
 * 422 → `INVALID_BODY` + `field`) is pinned in `src/server/routes/remote-project.route.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { createElement: h } = await import('react');
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: ({ to, hash, children }: { to: string; hash?: string; children?: unknown }) =>
      h('a', { href: hash ? `${to}#${hash}` : to }, children as never),
  };
});

import { RELEASE_PUSH_SETTINGS } from './RemoteProjectElement.js';
import { REMOTE_ACCOUNT_SETTINGS } from '../account/UserCardElement.js';
import { ConfirmLayer } from '../../ui/ConfirmModal.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RemoteProjectCard = RELEASE_PUSH_SETTINGS.elements![0]!.component!;
const UserCard = REMOTE_ACCOUNT_SETTINGS.elements![0]!.component!;

const PROJECT_ID = '7d0c3c0e-1f7a-4a53-9a4e-2b1b3f0d9c11';
const OWNER_VIEW = {
  linked: true,
  projectId: PROJECT_ID,
  fetched: true,
  isOwner: true,
  project: {
    name: 'Alpha',
    description: 'The original description',
    createdAt: '2026-09-01T10:00:00.000Z',
    owner: { email: 'ada@example.com' },
  },
};
const NOT_FOUND_VIEW = { linked: true, projectId: PROJECT_ID, fetched: false, isOwner: false, reason: 'not_found' };

type Answer = { status: number; body: unknown };
let host: HTMLDivElement;
let root: Root;
let toasts: Array<{ variant: string; message: string }>;
let requests: Array<{ url: string; method: string; body?: string }>;
let remoteProject: unknown;
let patchAnswer: Answer;
let connected: boolean;
let afterLogout: unknown;
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  toasts = [];
  requests = [];
  remoteProject = OWNER_VIEW;
  patchAnswer = { status: 200, body: OWNER_VIEW };
  connected = true;
  afterLogout = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/remote-project' && method === 'GET') return json(remoteProject);
      if (url === '/api/remote-project' && method === 'PATCH') return json(patchAnswer.body, patchAnswer.status);
      if (url === '/api/remote-account' && method === 'GET') {
        return json(
          connected
            ? { connected: true, remoteAccountId: 'a', accountEmail: 'ada@example.com', accountStatus: 'active', connectedAt: '2026-10-01T10:00:00.000Z' }
            : { connected: false },
        );
      }
      if (url === '/api/remote-account/logout' && method === 'POST') {
        connected = false;
        if (afterLogout) remoteProject = afterLogout;
        return json({ connected: false });
      }
      return json({}, 404);
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

async function render(withUserCard = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        withUserCard ? createElement('section', { 'data-testid': 'user-card' }, createElement(UserCard, {} as never)) : null,
        createElement('section', { 'data-testid': 'remote-project' }, createElement(RemoteProjectCard, {} as never)),
        createElement(ConfirmLayer),
      ),
    );
  });
  await flush();
}

const card = () => host.querySelector<HTMLElement>('[data-testid="remote-project"]')!;
const buttonsIn = (el: ParentNode, label: string) =>
  Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label);
const click = async (el: HTMLElement | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.click();
  });
  await flush();
};
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
};
const nameInput = () => card().querySelector<HTMLInputElement>('input[type="text"]')!;
const descriptionInput = () => card().querySelector<HTMLTextAreaElement>('textarea')!;
/** The `<label>` of a form field — the control and its error live inside it. */
const fieldOf = (label: string) =>
  Array.from(card().querySelectorAll('label')).find((l) => l.querySelector('span')?.textContent === label)!;

describe('Settings → Remote project card (M26/M25)', () => {
  it('[ac:ac-anonim-bez-sesji-konta-zdalnego-przy] an anonymous reader of a draft project sees the "Cannot fetch project info…" banner — the one a deleted project or a bad identifier gets', async () => {
    // What the proxy answers an anonymous reader of a draft (no bearer → remote 404):
    // the very body it answers for a deleted project or an invalid identifier.
    connected = false;
    remoteProject = NOT_FOUND_VIEW;
    await render();
    const text = card().textContent ?? '';
    expect(text.startsWith('Cannot fetch project info')).toBe(true);
    expect(text).toContain('draft, deleted, or you don');
    expect(text).toContain(PROJECT_ID);
    // No read-only view and no edit form for it.
    expect(card().querySelector('input, textarea')).toBeNull();
    expect(text).not.toContain('Read-only');
  });

  it('[ac:ac-sekcja-remote-project-gdy-projekt-usunie] linked but not fetchable (reason not_found) → the "Cannot fetch project info (draft, deleted, or no access)" banner with Disconnect, and nothing is cleared automatically', async () => {
    remoteProject = NOT_FOUND_VIEW;
    await render();
    const text = card().textContent ?? '';
    expect(text).toContain('Cannot fetch project info');
    expect(text).toContain('draft, deleted, or you don');
    expect(buttonsIn(card(), 'Disconnect')).toHaveLength(1);
    expect(buttonsIn(card(), 'Retry')).toEqual([]);
    // No auto-clear: only the read went out — no PATCH /api/config clearing remoteProjectId.
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
    expect(requests.some((r) => r.url.startsWith('/api/config'))).toBe(false);
    // Disconnect is a suggestion the user acts on: it asks first.
    await click(buttonsIn(card(), 'Disconnect')[0]);
    expect(document.querySelector('[data-modal-kind]')?.getAttribute('data-modal-kind')).toBe('remote-project-disconnect');
    expect(requests.some((r) => r.method !== 'GET')).toBe(false);
  });

  it('[ac:ac-odmowa-422-invalid-body-z-uslugi-zdal] a 422 INVALID_BODY from the remote service for a value the client let through shows the response message under the field it concerns', async () => {
    patchAnswer = {
      status: 422,
      body: { error: { code: 'INVALID_BODY', message: 'name must not contain reserved words', field: 'name' } },
    };
    await render();
    await typeInto(nameInput(), 'Admin project');
    const save = buttonsIn(card(), 'Save changes')[0] as HTMLButtonElement;
    expect(save.disabled).toBe(false); // the client's own checks let it through
    await click(save);

    const patch = requests.filter((r) => r.method === 'PATCH');
    expect(patch).toEqual([{ url: '/api/remote-project', method: 'PATCH', body: JSON.stringify({ name: 'Admin project' }) }]);
    expect(fieldOf('Name').textContent).toContain('name must not contain reserved words');
    expect(fieldOf('Description').textContent).not.toContain('name must not contain reserved words');
    // Under the field, not as a toast; the typed value stays for correction.
    expect(toasts).toEqual([]);
    expect(nameInput().value).toBe('Admin project');
  });

  it('[ac:ac-odmowa-edycji-projektu-zdalnego-kodem] an edit refused with NOT_OWNER shows the toast "You are not the owner of this project"', async () => {
    patchAnswer = {
      status: 403,
      body: { error: { code: 'NOT_OWNER', message: 'you are not the owner of this remote project' } },
    };
    await render();
    await typeInto(descriptionInput(), 'New description');
    await click(buttonsIn(card(), 'Save changes')[0]);

    expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    expect(toasts).toContainEqual({ variant: 'error', message: 'You are not the owner of this project' });
  });

  it('[ac:ac-wylogowanie-konta-zdalnego-w-trakcie] logging the remote account out while editing the Remote project form discards the unsaved name and description', async () => {
    // After logout the proxy reads anonymously: the published project comes back read-only.
    afterLogout = { ...OWNER_VIEW, isOwner: false, project: { ...OWNER_VIEW.project, owner: undefined } };
    await render(true);
    await typeInto(nameInput(), 'Unsaved name');
    await typeInto(descriptionInput(), 'Unsaved description');
    expect(nameInput().value).toBe('Unsaved name');

    // Log out from the User card (ConfirmModal → confirm).
    const userCard = host.querySelector<HTMLElement>('[data-testid="user-card"]')!;
    await click(buttonsIn(userCard, 'Log out')[0]);
    const confirm = buttonsIn(document, 'Log out');
    await click(confirm[confirm.length - 1]);

    expect(requests).toContainEqual({ url: '/api/remote-account/logout', method: 'POST' });
    // No PATCH ever went out — the edits were never saved.
    expect(requests.some((r) => r.url === '/api/remote-project' && r.method === 'PATCH')).toBe(false);
    // The form is gone and its unsaved values with it; the card shows the remote state.
    expect(card().querySelector('input, textarea')).toBeNull();
    const text = card().textContent ?? '';
    expect(text).not.toContain('Unsaved name');
    expect(text).not.toContain('Unsaved description');
    expect(text).toContain('Alpha');
    expect(text).toContain('The original description');
  });
});
