// @vitest-environment happy-dom
/**
 * 2.1.48 (M23 `patch-page`, M21 brief page) — the WS echo of this tab's own
 * save does not refetch the whole-file detail; somebody else's write does.
 *
 * A patch's / brief's detail query holds the WHOLE file (the artifact detail
 * route's default projection). After a save the mutation writes that cache
 * from the sent content and the PUT's hash, so the server's echo of the same
 * write must not re-download the file — that refetch is also the race that
 * put an older hash back into the cache and made the next autosave 409. But
 * `origin: 'server'` labels every app write (an agent's tool, another tab):
 * those must still refresh the open screen.
 *
 * A patch CONTENT save has no echo (the frontmatter goes back byte-identical,
 * so nothing is broadcast) and takes no own-write token: a `patches:changed`
 * during it is another writer's and refetches. Only the `applied` flip's echo
 * is absorbed.
 *
 * The real `useFileWatcher`, `usePatches` / `useBriefs` hooks, `patchesApi` /
 * `briefsApi` and the own-write ledger run; the WebSocket and `fetch` (the
 * server) are fakes. Patches are longer than the response budget, so the
 * cache written after a save is checked to still end with the file's last line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_BUDGET_CHARS } from '../../server/discovery/budget.js';

vi.mock('../runtime/boot-plugins.js', () => ({ reloadFrontendPlugins: () => Promise.resolve() }));
vi.mock('../core/plugin-host/host.js', () => ({
  clientPluginHost: { getAvailable: () => undefined, listEntities: () => [] },
}));

import { useFileWatcher } from './useFileWatcher.js';
import { usePatch, useSetPatchApplied, useUpdatePatchContent } from './usePatches.js';
import { useBrief, useUpdateBriefContent } from './useBriefs.js';
import { resetOwnWrites } from '../lib/own-writes.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal WebSocket double: the test plays server events through `emit`. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {}
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
const socket = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

const LAST = 'LAST LINE OF THE FILE';
const FM = '---\ntype: patch\npatch_kind: drift\n---\n';
const longBody = (head: string) =>
  `# ${head}\n\n` +
  Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `Line ${i} ${'x'.repeat(40)}`).join('\n\n') +
  `\n\n${LAST}\n`;

/** The server: one file per kind; a PUT can be held in flight to play an echo during it. */
const server = {
  file: { patch: '', brief: '' } as Record<'patch' | 'brief', string>,
  hash: { patch: 'h1', brief: 'b1' } as Record<'patch' | 'brief', string>,
  reads: { patch: 0, brief: 0 } as Record<'patch' | 'brief', number>,
  hold: null as null | { release: null | (() => void) },
  conflict: false,
};

/**
 * A plain response double, not a `Response`: its body is read with no stream
 * machinery, so nothing in it waits on the faked timers.
 */
const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, statusText: String(status), json: async () => body }) as unknown as Response;

async function fakeFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const m = /\/artifacts\/(patch|brief)\/doc\.md(\/content|\/frontmatter)?$/.exec(url);
  if (!m) return json(404, { error: { code: 'NOT_FOUND', message: url } });
  const kind = m[1] as 'patch' | 'brief';
  if (method === 'GET' && !m[2]) {
    server.reads[kind] += 1;
    const content = server.file[kind];
    return json(200, {
      data: { path: 'doc.md', frontmatter: { type: kind }, body: content.slice(FM.length), content, hash: server.hash[kind] },
    });
  }
  if (method === 'PUT' && m[2] === '/content') {
    if (server.hold) await new Promise<void>((r) => (server.hold!.release = r));
    if (server.conflict) {
      return json(409, { error: { code: 'PATCH_CONFLICT', message: 'hash mismatch', currentHash: 'other' } });
    }
    const { content } = JSON.parse(String(init!.body)) as { content: string };
    server.file[kind] = content;
    server.hash[kind] = `${server.hash[kind]}+`;
    return json(200, { data: { path: 'doc.md', hash: server.hash[kind], frontmatter: { type: kind } } });
  }
  if (method === 'PATCH' && m[2] === '/frontmatter') {
    if (server.hold) await new Promise<void>((r) => (server.hold!.release = r));
    server.hash[kind] = `${server.hash[kind]}*`;
    return json(200, { data: { path: 'doc.md', hash: server.hash[kind], frontmatter: { type: kind, applied: true } } });
  }
  return json(405, { error: { code: 'METHOD', message: method } });
}

const h = {
  savePatch: null as null | ((content: string) => Promise<unknown>),
  setApplied: null as null | ((applied: boolean) => Promise<unknown>),
  saveBrief: null as null | ((content: string) => Promise<unknown>),
  patch: null as null | { content: string; hash: string },
  brief: null as null | { content: string; hash: string },
};

/** An open patch screen and an open brief screen under the global watcher. */
function OpenScreens() {
  useFileWatcher();
  const patch = usePatch('doc.md');
  const brief = useBrief('doc.md');
  const updatePatch = useUpdatePatchContent('doc.md');
  const applied = useSetPatchApplied('doc.md');
  const updateBrief = useUpdateBriefContent('doc.md');
  h.patch = patch.data ?? null;
  h.brief = brief.data ?? null;
  h.savePatch = (content) => updatePatch.mutateAsync({ content, expectedHash: patch.data!.hash });
  h.setApplied = (v) => applied.mutateAsync(v);
  h.saveBrief = (content) => updateBrief.mutateAsync({ content, expectedHash: brief.data!.hash });
  return null;
}

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
/** Past the watcher's 500 ms batch window, then React Query's notifications. */
async function pastBatchWindow() {
  await settle(500);
  await settle(1);
  await settle(1);
}
async function mount() {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(OpenScreens)));
  });
  await settle(1);
  await settle(1);
  await settle(1);
}
/** Start a save whose request is held in flight (it reached the server); returns how to answer it. */
async function startHeldSave(run: () => Promise<unknown>) {
  const hold: { release: null | (() => void) } = { release: null };
  server.hold = hold;
  let done: Promise<unknown> = Promise.resolve();
  await act(async () => {
    done = run().catch(() => undefined);
  });
  for (let i = 0; i < 20 && !hold.release; i++) await settle(0);
  expect(hold.release).not.toBeNull();
  return async () => {
    server.hold = null;
    await act(async () => {
      hold.release!();
      await done;
    });
    await settle(1);
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  resetOwnWrites();
  server.file = { patch: FM + longBody('Patch'), brief: FM + longBody('Brief') };
  server.hash = { patch: 'h1', brief: 'b1' };
  server.reads = { patch: 0, brief: 0 };
  server.hold = null;
  server.conflict = false;
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  qc.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('own-save echo vs. another writer — patch screen', () => {
  it('[entity:patch-page] a body-only autosave does not refetch the whole patch; the cache keeps the PUT\'s hash and the file\'s last line', async () => {
    await mount();
    expect(server.reads.patch).toBe(1);
    const next = FM + longBody('Patch v2');
    // A content save keeps the frontmatter byte-identical: the server
    // broadcasts nothing for it, so no event is played.
    const answer = await startHeldSave(() => h.savePatch!(next));
    await answer();
    await pastBatchWindow();

    expect(server.reads.patch).toBe(1);
    expect(h.patch!.hash).toBe('h1+');
    expect(h.patch!.content).toBe(next);
    expect(h.patch!.content.trimEnd().endsWith(LAST)).toBe(true);
  });

  it('[entity:patch-page] a server-origin write by another writer (file:changed origin server, patches:changed with no own save) refetches the open patch', async () => {
    await mount();
    server.file.patch = FM + longBody('Edited by the agent');
    server.hash.patch = 'agent';
    act(() => socket().emit({ kind: 'file:changed', event: 'change', path: 'doc.md', rootId: 'patches', origin: 'server' }));
    await pastBatchWindow();
    expect(server.reads.patch).toBe(2);
    expect(h.patch!.hash).toBe('agent');

    act(() => socket().emit({ kind: 'patches:changed', path: 'doc.md' }));
    await pastBatchWindow();
    expect(server.reads.patch).toBe(3);
  });

  it('[entity:patch-page] a patches:changed arriving during a content save is another writer\'s (e.g. mark_patch_applied) and still refetches the detail', async () => {
    await mount();
    const answer = await startHeldSave(() => h.savePatch!(FM + longBody('Patch v2')));
    // The agent flips `applied` while this tab's PUT is in flight.
    act(() => socket().emit({ kind: 'patches:changed', path: 'doc.md' }));
    await answer();
    await pastBatchWindow();
    expect(server.reads.patch).toBe(2);
    expect(h.patch!.hash).toBe(server.hash.patch);
  });

  it('[entity:patch-page] a patches:changed arriving during a content save that fails (409) refetches the detail', async () => {
    await mount();
    server.conflict = true;
    const answer = await startHeldSave(() => h.savePatch!(FM + longBody('Patch v2')));
    act(() => socket().emit({ kind: 'patches:changed', path: 'doc.md' }));
    await answer();
    await pastBatchWindow();
    expect(server.reads.patch).toBe(2);
  });

  it('[entity:patch-page] the applied flip refetches the detail once — its patches:changed echo adds no second refetch', async () => {
    await mount();
    const answer = await startHeldSave(() => h.setApplied!(true));
    act(() => socket().emit({ kind: 'patches:changed', path: 'doc.md' }));
    await answer();
    await pastBatchWindow();
    expect(server.reads.patch).toBe(2);
  });
});

describe('own-save echo vs. another writer — brief screen (same mechanism)', () => {
  it('the briefs:changed echo of this tab\'s save does not refetch the brief, also when it lands after the PUT answered; the next server-origin write does', async () => {
    await mount();
    expect(server.reads.brief).toBe(1);
    const next = FM + longBody('Brief v2');
    const answer = await startHeldSave(() => h.saveBrief!(next));
    await answer();
    // The echo arrives after the response (separate sockets).
    act(() => socket().emit({ kind: 'briefs:changed', path: 'doc.md', origin: 'server' }));
    await pastBatchWindow();
    expect(server.reads.brief).toBe(1);
    expect(h.brief!.hash).toBe('b1+');
    expect(h.brief!.content).toBe(next);

    // Another tab saves the brief: same event, no own save pending → refetched.
    act(() => socket().emit({ kind: 'briefs:changed', path: 'doc.md', origin: 'server' }));
    await pastBatchWindow();
    expect(server.reads.brief).toBe(2);
  });

  it('a socket reconnect drops a pending echo: the next server-origin briefs:changed refetches', async () => {
    await mount();
    act(() => socket().onopen?.());
    const answer = await startHeldSave(() => h.saveBrief!(FM + longBody('Brief v2')));
    await answer();
    // The echo was lost while the socket was down; it reconnects.
    act(() => socket().onopen?.());
    act(() => socket().emit({ kind: 'briefs:changed', path: 'doc.md', origin: 'server' }));
    await pastBatchWindow();
    expect(server.reads.brief).toBe(2);
  });
});
