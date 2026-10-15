// @vitest-environment happy-dom
/**
 * M26 `#user-section` (ui-view `settings-page`) × M24 sidebar User slot.
 *
 * The User card on `/settings` is the only place [Log out] lives: the sidebar
 * slot has no dropdown in the signed-in state. While a device flow runs the
 * account is still `connected: false`, so the card never offers [Log out] then.
 *
 * The remote account is driven through a fetch stub of the local API
 * (`/api/remote-account*`) — the same seam the browser uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { createElement: h } = await import('react');
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children?: unknown } & Record<string, unknown>) =>
      h('a', { ...rest, href: hash ? `${to}#${hash}` : to }, children as never),
  };
});

import { REMOTE_ACCOUNT_SETTINGS } from './UserCardElement.js';
import { UserSection } from '../UserSection.js';
import { ConfirmLayer } from '../../ui/ConfirmModal.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UserCard = REMOTE_ACCOUNT_SETTINGS.elements![0]!.component!;

const ACCOUNT = {
  connected: true,
  remoteAccountId: 'acc-1',
  accountEmail: 'ada@example.com',
  accountStatus: 'active',
  connectedAt: '2026-10-01T10:00:00.000Z',
};

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;
let connected: boolean;
let requests: Array<{ url: string; method: string }>;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  connected = true;
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push({ url, method });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/remote-account' && method === 'GET') return json(connected ? ACCOUNT : { connected: false });
      if (url === '/api/remote-account/logout' && method === 'POST') {
        connected = false;
        return json({ connected: false });
      }
      if (url === '/api/remote-account/login/start' && method === 'POST') {
        return json({
          user_code: 'WXYZ-1234',
          verification_uri: 'https://remote.example/device',
          verification_uri_complete: 'https://remote.example/device?code=WXYZ-1234',
          // Long enough that no poll fires while the test looks at the screen.
          interval: 600,
          expires_in: 900,
        });
      }
      if (url === '/api/remote-project') return json({ linked: false, projectId: null, fetched: false, isOwner: false });
      return json({}, 404);
    }),
  );
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement('aside', { 'data-testid': 'sidebar' }, createElement(UserSection)),
        createElement('section', { 'data-testid': 'user-card' }, createElement(UserCard, {} as never)),
        createElement(ConfirmLayer),
      ),
    );
  });
  await flush();
}

const region = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const buttonsIn = (el: ParentNode, label: string) =>
  Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label);
const confirmWindow = () => document.querySelector<HTMLElement>('[data-modal-kind]');
const click = async (el: HTMLElement | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.click();
  });
  await flush();
};

describe('Settings User card × sidebar User slot (M24/M26)', () => {
  it('[ac:ac-logout-w-m26-sekcja-user-z-confirmmodal] Log out on the User card asks in a ConfirmModal, POSTs /api/remote-account/logout, invalidates remote-account and remote-project, and the sidebar slot returns to Log in — the sidebar never offers Log out', async () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await render();

    // Signed in: the sidebar slot is a link to the User card, with no Log out of its own.
    expect(region('sidebar').textContent).toContain('ada@example.com');
    expect(buttonsIn(region('sidebar'), 'Log out')).toEqual([]);
    expect(region('sidebar').querySelector('a')?.getAttribute('href')).toBe('/settings#user-section');
    const cardLogout = buttonsIn(region('user-card'), 'Log out');
    expect(cardLogout).toHaveLength(1);

    // [Log out] → ConfirmModal first; nothing is sent before the confirmation.
    await click(cardLogout[0]);
    expect(confirmWindow()?.getAttribute('data-modal-kind')).toBe('account-logout');
    expect(requests.some((r) => r.url === '/api/remote-account/logout')).toBe(false);

    // Confirm (the modal's own [Log out], rendered after the card's).
    const modalButtons = buttonsIn(document, 'Log out');
    await click(modalButtons[modalButtons.length - 1]);

    expect(requests.filter((r) => r.url === '/api/remote-account/logout')).toEqual([
      { url: '/api/remote-account/logout', method: 'POST' },
    ]);
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey?: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['remote-account']));
    expect(keys).toContain(JSON.stringify(['remote-project']));

    // The session is gone: the sidebar slot is back to its signed-out state (Log in).
    expect(confirmWindow()).toBeNull();
    expect(buttonsIn(region('sidebar'), 'Log in')).toHaveLength(1);
    expect(region('sidebar').textContent).not.toContain('ada@example.com');
    expect(buttonsIn(document, 'Log out')).toEqual([]);
  });

  it('[ac:ac-gdy-logowanie-device-flow-jest-w-toku] while a device flow runs (connected: false) the User card shows no Log out', async () => {
    connected = false;
    await render();
    expect(buttonsIn(region('user-card'), 'Log out')).toEqual([]);

    // The card's [Log in] starts the slot's device flow.
    await click(buttonsIn(region('user-card'), 'Log in')[0]);
    expect(requests).toContainEqual({ url: '/api/remote-account/login/start', method: 'POST' });
    expect(region('sidebar').textContent).toContain('WXYZ-1234');
    expect(region('sidebar').textContent).toContain('Waiting for authorization');

    // Flow in progress, account still `connected: false`: no Log out on the card (nor anywhere).
    expect(qc.getQueryData<{ connected: boolean }>(['remote-account'])?.connected).toBe(false);
    expect(buttonsIn(region('user-card'), 'Log out')).toEqual([]);
    expect(buttonsIn(document, 'Log out')).toEqual([]);
  });
});
