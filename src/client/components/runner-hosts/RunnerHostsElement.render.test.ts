// @vitest-environment happy-dom
/**
 * 2.1.62 — the `#runner-hosts` card element (M54 L5 `wzku2ck1`, L12 `g6rwer8u`,
 * L17 `cx6b7xjn` / `eqge2a8m`). The element renders beside the REAL window host
 * (`ModalHost`, with its confirm layer), so the create / edit / remove windows
 * are the ones a user gets; `fetch` is stubbed with the route's answers and
 * every request is recorded. Toasts are read off the shell's toast bus.
 *
 * The acceptance criteria of the card are end-to-end (tests/e2e/runner-hosts.test.ts);
 * this file pins the anatomy and the request/toast wiring without a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ModalHost } from '../../ui/ModalHost.js';
import { UI_EVENTS } from '../../ui/events.js';
import { RUNNER_HOSTS_HTTP_NOTE, RUNNER_HOSTS_POLL_MS, RunnerHostsElement, TOKEN_REJECTED_HINT } from './RunnerHostsElement.js';
import { RUNNER_HOST_TOKEN_HELP, RUNNER_HOST_TOKEN_KEEP_HELP } from './RunnerHostDialog.js';
import { RUNNER_HOSTS_QUERY_KEY, editToast, testToast, type RunnerHostResponse } from '../../lib/runner-hosts.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIST_URL = '/api/workspace/runner-hosts?limit=200';

function hostOf(over: Partial<RunnerHostResponse> = {}): RunnerHostResponse {
  return {
    id: 'r1',
    url: 'http://10.0.0.5:7420',
    label: null,
    token: { isSet: true, last4: 'wxyz' },
    binding: { hostId: 'h_1', hostName: 'kb-ec2', runnerVersion: '0.1.0', startedAt: '2026-10-27T09:12:03Z' },
    status: 'connected',
    statusSince: '2026-10-29T10:00:00.000Z',
    lastEventAt: '2026-10-29T10:00:01.000Z',
    lastError: null,
    restartedAt: null,
    ...over,
  };
}

type Answer = { status: number; body: unknown };

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let list: RunnerHostResponse[];
let requests: Array<{ url: string; method: string; body?: unknown }>;
let answers: Map<string, Answer>;
let toasts: Array<{ variant: string; message: string }>;
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RunnerHostsElement),
        createElement(ModalHost),
      ),
    );
  });
  await flush();
}

const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="runner-host-row"]')];
const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.click();
  });
  await flush();
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  list = [];
  requests = [];
  answers = new Map();
  toasts = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.addEventListener(UI_EVENTS.TOAST, onToast);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ url: String(url), method, ...(body !== undefined ? { body } : {}) });
      const answer = answers.get(`${method} ${url}`);
      if (answer) return new Response(JSON.stringify(answer.body), { status: answer.status });
      if (method === 'GET' && url === LIST_URL) {
        return new Response(JSON.stringify({ data: list, total: list.length }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: String(url) } }), { status: 404 });
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  queryClient.clear();
  window.removeEventListener(UI_EVENTS.TOAST, onToast);
  vi.unstubAllGlobals();
});

describe('M54 #runner-hosts card element', () => {
  it('[section:wzku2ck1] reads the list under the key ["runner-hosts"], polled every 5 s, from the workspace route without a project prefix', async () => {
    list = [hostOf()];
    await render();
    expect(requests.filter((r) => r.method === 'GET').map((r) => r.url)).toEqual([LIST_URL]);
    const query = queryClient.getQueryCache().find({ queryKey: [...RUNNER_HOSTS_QUERY_KEY], exact: true });
    expect(query).toBeDefined();
    expect(RUNNER_HOSTS_POLL_MS).toBe(5_000);
    expect(query!.observers.map((o) => o.options.refetchInterval)).toEqual([RUNNER_HOSTS_POLL_MS]);
    // One query entry, no other keys left in the cache.
    expect(queryClient.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([['runner-hosts']]);
  });

  it('[section:eqge2a8m] a row shows the label or hostName, the url, the token mask, the status badge with statusSince, lastError, runnerVersion and Restarted when set', async () => {
    list = [
      hostOf({ id: 'a', label: 'build box', restartedAt: '2026-10-29T10:05:00.000Z' }),
      hostOf({
        id: 'b',
        url: 'http://10.0.0.6:7420',
        status: 'unreachable',
        lastError: { code: 'connect_refused', message: 'connection refused' },
      }),
    ];
    await render();
    const [a, b] = rows();
    expect(a!.querySelector('[data-testid="runner-host-name"]')!.textContent).toBe('build box');
    expect(b!.querySelector('[data-testid="runner-host-name"]')!.textContent).toBe('kb-ec2');
    expect(a!.querySelector('[data-testid="runner-host-url"]')!.textContent).toBe('http://10.0.0.5:7420');
    expect(a!.querySelector('[data-testid="runner-host-token"]')!.textContent).toBe('••••wxyz');
    expect(a!.querySelector('[data-testid="runner-host-status"]')!.textContent).toBe('Connected');
    expect(a!.querySelector('[data-testid="runner-host-status-since"]')!.textContent).toContain('since');
    expect(a!.querySelector('[data-testid="runner-host-version"]')!.textContent).toContain('0.1.0');
    expect(a!.querySelector('[data-testid="runner-host-restarted"]')!.textContent).toMatch(/^Restarted /);
    expect(b!.querySelector('[data-testid="runner-host-restarted"]')).toBeNull();
    expect(b!.querySelector('[data-testid="runner-host-status"]')!.textContent).toBe('Unreachable');
    expect(b!.querySelector('[data-testid="runner-host-last-error"]')!.textContent).toBe('connection refused');
    // Actions of every row; Bind only at Different host.
    for (const row of [a!, b!]) {
      expect(buttonIn(row, 'Test connection')).not.toBeNull();
      expect(buttonIn(row, 'Edit')).not.toBeNull();
      expect(buttonIn(row, 'Remove')).not.toBeNull();
      expect(buttonIn(row, 'Bind to this host')).toBeNull();
    }
    expect(host.querySelector('[data-testid="runner-hosts-note"]')!.textContent).toBe(RUNNER_HOSTS_HTTP_NOTE);
  });

  it('[section:eqge2a8m] the ten status labels; Token rejected carries the hint, Different host the [Bind to this host] action', async () => {
    const statuses = [
      ['connecting', 'Connecting'],
      ['connected', 'Connected'],
      ['unreachable', 'Unreachable'],
      ['retrying', 'Retrying'],
      ['stopped', 'Stopped'],
      ['token-rejected', 'Token rejected'],
      ['token-unreadable', 'Token unreadable'],
      ['protocol-mismatch', 'Protocol mismatch'],
      ['other-host', 'Different host'],
      ['bad-response', 'Bad response'],
    ] as const;
    list = statuses.map(([status], i) => hostOf({ id: `h${i}`, url: `http://10.0.0.${i}:7420`, status }));
    await render();
    const all = rows();
    expect(all.map((r) => r.querySelector('[data-testid="runner-host-status"]')!.textContent)).toEqual(
      statuses.map(([, label]) => label),
    );
    for (const [i, [status]] of statuses.entries()) {
      const row = all[i]!;
      expect(!!buttonIn(row, 'Bind to this host'), status).toBe(status === 'other-host');
      const hint = row.querySelector('[data-testid="runner-host-token-rejected-hint"]');
      expect(hint?.textContent ?? null, status).toBe(status === 'token-rejected' ? TOKEN_REJECTED_HINT : null);
    }
  });

  it('[section:eqge2a8m] [section:wzku2ck1] the empty state opens runner-host-create; the add posts create-runner-host-request, refetches and toasts', async () => {
    await render();
    expect(host.textContent).toContain('No runner hosts yet');
    await click(buttonIn(host, 'Add runner host'));
    const d = dialog()!;
    expect(d).not.toBeNull();
    const url = d.querySelector<HTMLInputElement>('input[name="url"]')!;
    const token = d.querySelector<HTMLInputElement>('input[name="token"]')!;
    expect(d.querySelector('input[name="label"]')).not.toBeNull();
    expect(url.placeholder).toBe('http://host:7420');
    expect(token.type).toBe('password');
    expect(d.textContent).toContain(RUNNER_HOST_TOKEN_HELP);

    const created = hostOf({ id: 'new' });
    answers.set('POST /api/workspace/runner-hosts', { status: 201, body: { data: created } });
    await type(url, 'http://10.0.0.5:7420');
    await type(token, 'c4sr_abcdwxyz');
    list = [created];
    const getsBefore = requests.filter((r) => r.method === 'GET').length;
    await click(buttonIn(d, 'Add runner host'));

    expect(requests.find((r) => r.method === 'POST')).toEqual({
      url: '/api/workspace/runner-hosts',
      method: 'POST',
      body: { url: 'http://10.0.0.5:7420', token: 'c4sr_abcdwxyz' },
    });
    expect(dialog()).toBeNull();
    expect(requests.filter((r) => r.method === 'GET').length).toBeGreaterThan(getsBefore);
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Runner host added.' }));
    expect(rows()).toHaveLength(1);
  });

  it('[section:wzku2ck1] a validation error stands under the field it is about, and the window stays open', async () => {
    await render();
    await click(buttonIn(host, 'Add runner host'));
    const d = dialog()!;
    answers.set('POST /api/workspace/runner-hosts', {
      status: 400,
      body: { error: { code: 'VALIDATION', message: 'token: a master token starts with "c4sr_"' } },
    });
    await type(d.querySelector<HTMLInputElement>('input[name="url"]')!, 'http://10.0.0.5:7420');
    await type(d.querySelector<HTMLInputElement>('input[name="token"]')!, 'nope');
    await click(buttonIn(d, 'Add runner host'));
    expect(dialog()).not.toBeNull();
    // Each FormField is the input's parent: label, control, helper, error.
    const tokenField = d.querySelector('input[name="token"]')!.parentElement!;
    expect(tokenField.textContent).toContain('a master token starts with "c4sr_"');
    const urlField = d.querySelector('input[name="url"]')!.parentElement!;
    expect(urlField.textContent).not.toContain('c4sr_');
    expect(toasts).toEqual([]);
  });

  it('[section:wzku2ck1] runner-host-edit: the token starts empty with its helper; an empty token is not sent; the save toasts "Runner host updated."', async () => {
    list = [hostOf({ label: 'box' })];
    await render();
    await click(buttonIn(rows()[0]!, 'Edit'));
    const d = dialog()!;
    expect(d.querySelector<HTMLInputElement>('input[name="url"]')!.value).toBe('http://10.0.0.5:7420');
    expect(d.querySelector<HTMLInputElement>('input[name="token"]')!.value).toBe('');
    expect(d.textContent).toContain(RUNNER_HOST_TOKEN_KEEP_HELP);
    answers.set('PATCH /api/workspace/runner-hosts/r1', { status: 200, body: { data: hostOf({ label: 'box 2' }) } });
    await type(d.querySelector<HTMLInputElement>('input[name="label"]')!, 'box 2');
    await click(buttonIn(d, 'Save'));
    expect(requests.find((r) => r.method === 'PATCH')).toEqual({
      url: '/api/workspace/runner-hosts/r1',
      method: 'PATCH',
      body: { label: 'box 2' },
    });
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Runner host updated.' }));
  });

  it('[section:wzku2ck1] runner-host-remove confirms with the name, deletes the record and toasts "Runner host removed."', async () => {
    list = [hostOf()];
    await render();
    await click(buttonIn(rows()[0]!, 'Remove'));
    const d = dialog()!;
    expect(d.textContent).toContain('Remove runner host kb-ec2? The token stored for it is deleted.');
    answers.set('DELETE /api/workspace/runner-hosts/r1', { status: 200, body: { data: { id: 'r1' } } });
    list = [];
    await click(buttonIn(d, 'Remove'));
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/workspace/runner-hosts/r1')).toBe(true);
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Runner host removed.' }));
    expect(rows()).toHaveLength(0);
  });

  it('[section:wzku2ck1] [Test connection] posts the test and toasts the outcome; [Bind to this host] sends rebind', async () => {
    list = [hostOf({ status: 'other-host' })];
    await render();
    answers.set('POST /api/workspace/runner-hosts/r1/test', {
      status: 200,
      body: {
        data: hostOf({
          binding: { hostId: 'h_2', hostName: 'kb-new', runnerVersion: '0.2.0', startedAt: '2026-10-29T09:00:00Z' },
        }),
      },
    });
    await click(buttonIn(rows()[0]!, 'Bind to this host'));
    expect(requests.find((r) => r.url.endsWith('/test'))).toEqual({
      url: '/api/workspace/runner-hosts/r1/test',
      method: 'POST',
      body: { rebind: true },
    });
    expect(toasts).toContainEqual(expect.objectContaining({ variant: 'success', message: 'Bound to kb-new.' }));

    answers.set('POST /api/workspace/runner-hosts/r1/test', { status: 200, body: { data: hostOf({ status: 'unreachable' }) } });
    await click(buttonIn(rows()[0]!, 'Test connection'));
    expect(requests.filter((r) => r.url.endsWith('/test')).at(-1)!.body).toEqual({});
    expect(toasts).toContainEqual(
      expect.objectContaining({ variant: 'error', message: 'Connection test failed: Unreachable.' }),
    );
  });

  it('[section:wzku2ck1] the toast table: test, rebind and a token change that bound a different host', () => {
    const before = hostOf();
    expect(testToast(before, hostOf(), false)).toEqual({ kind: 'success', message: 'Connected to kb-ec2.' });
    expect(testToast(before, hostOf({ status: 'token-rejected' }), false)).toEqual({
      kind: 'error',
      message: 'Connection test failed: Token rejected.',
    });
    const other = hostOf({
      binding: { hostId: 'h_9', hostName: 'kb-9', runnerVersion: '0.1.0', startedAt: '2026-10-29T09:00:00Z' },
    });
    expect(testToast(before, other, true)).toEqual({ kind: 'success', message: 'Bound to kb-9.' });
    expect(editToast(before, other, true)).toEqual({
      kind: 'success',
      message: 'Token accepted by a different host — now bound to kb-9.',
    });
    expect(editToast(before, other, false)).toEqual({ kind: 'success', message: 'Runner host updated.' });
    expect(editToast(before, hostOf(), true)).toEqual({ kind: 'success', message: 'Runner host updated.' });
  });
});
