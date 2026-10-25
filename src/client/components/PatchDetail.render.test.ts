// @vitest-environment happy-dom
/**
 * M23, ui-view `patch-page` — the patch page at `/patches/$`: header (title,
 * `patch_kind` badge, applied/pending badge, link to the brief), the Settings
 * popover with the `applied` toggle — which states that the user sets both
 * values while the patch thread's agent can only set it to `true`
 * (`mark_patch_applied`) — the artifact panel whose editor loads the WHOLE
 * patch from the detail route's default projection whatever its length
 * (2.1.48), the autosave that writes the whole file back with `{ content,
 * expectedHash }`, the `409 PATCH_CONFLICT` banner whose only action is
 * "Reload", and the "Change spec according to patch" action that opens the
 * chat overlay on a fresh patch thread. The entity lists no extra `states`, so
 * the default state (pending and applied variants) is the whole set.
 *
 * The real `PatchDetail`, `PatchEditor`, `usePatches` hooks and `patchesApi`
 * run; only `fetch` (the server) and tiptap's React binding (a document held as
 * a markdown string — happy-dom cannot host ProseMirror's selectors) are fakes.
 * Every patch here is LONGER than the response budget, so "the whole file" is
 * proven by its last line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_BUDGET_CHARS } from '../../server/discovery/budget.js';

interface FakeEditor {
  doc: string;
  isDestroyed: boolean;
  opts: { onUpdate?: (p: { editor: FakeEditor }) => void };
  storage: { markdown: { getMarkdown: () => string } };
  commands: { setContent: (md: string, emit?: boolean) => void };
  subscribe: (fn: () => void) => () => void;
  /** A user edit: the document changes and tiptap reports it. */
  type: (md: string) => void;
}

const h = vi.hoisted(() => ({
  editor: null as FakeEditor | null,
  chat: { threadId: null as string | null, open: false },
  makeEditor(): FakeEditor {
    const listeners = new Set<() => void>();
    const ed: FakeEditor = {
      doc: '',
      isDestroyed: false,
      opts: {},
      storage: { markdown: { getMarkdown: () => ed.doc } },
      commands: {
        setContent: (md: string) => {
          ed.doc = md;
          listeners.forEach((l) => l());
        },
      },
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      type: (md) => {
        ed.doc = md;
        listeners.forEach((l) => l());
        ed.opts.onUpdate?.({ editor: ed });
      },
    };
    return ed;
  },
}));

vi.mock('@tiptap/react', async () => {
  const React = await import('react');
  return {
    useEditor: (opts: FakeEditor['opts']) => {
      const [ed] = React.useState(() => h.makeEditor());
      ed.opts = opts;
      h.editor = ed;
      return ed;
    },
    EditorContent: (props: { editor?: FakeEditor | null }) => {
      const ed = props?.editor ?? null;
      const doc = React.useSyncExternalStore(
        (fn: () => void) => (ed ? ed.subscribe(fn) : () => {}),
        () => ed?.doc ?? '',
      );
      return React.createElement('div', { 'data-testid': 'patch-editor-doc' }, doc);
    },
  };
});
vi.mock('../tiptap/registrations.js', () => ({}));
vi.mock('../tiptap/EditorFactory.js', () => ({ EditorFactory: { buildExtensions: () => [] } }));
vi.mock('../tiptap/slashInvoke.js', () => ({ invokeSlash: () => {} }));
vi.mock('../tiptap/registry.js', () => ({
  assertSaveMode: () => ({ mode: 'debounce', debounceMs: 5 }),
  getContextSpec: () => ({}),
  getEditorSchemaVersion: () => 0,
  subscribeEditorSchema: () => () => {},
}));
vi.mock('../hooks/useArtifactThreads.js', () => ({
  artifactThreadsKey: (kind: string, path: string) => ['artifact-threads', kind, path],
  useArtifactThreads: () => ({
    threads: [],
    isPending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: async () => {},
  }),
}));
vi.mock('../state/chat.js', () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({
      setChatThreadId: (id: string) => {
        h.chat.threadId = id;
      },
      setChatOpen: (open: boolean) => {
        h.chat.open = open;
      },
    }),
}));
vi.mock('./ArtifactThreadsPanel.js', () => ({
  ArtifactThreadsPanel: (props: { title?: string }) =>
    createElement('div', { 'data-testid': 'artifact-threads-panel' }, props?.title),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: unknown; title?: string }) =>
    createElement('a', { 'data-testid': 'brief-link', title: props?.title }, props?.children as never),
}));

import { PatchDetail } from './PatchDetail.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LAST = 'LAST LINE OF THE PATCH';
const FRONTMATTER =
  '---\ntype: patch\nbrief: v1-to-v2.md\npatch_kind: drift\ncreated_at: 2026-10-01T10:00:00.000Z\ncreated_by: agent\n---\n';
const BODY =
  '# Drift in M23\n\n' +
  Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `Line ${i} ${'x'.repeat(40)}`).join('\n\n') +
  `\n\n${LAST}\n`;

/** The server: one patch file, served by the detail route's default projection, written by the content route. */
const server = {
  file: '',
  hash: 'h1',
  frontmatter: {} as Record<string, unknown>,
  calls: [] as Array<{ method: string; url: string; body?: string }>,
  conflict: false,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fakeFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? 'GET';
  server.calls.push({ method, url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
  if (method === 'GET' && /\/artifacts\/patch\/big\.md$/.test(url)) {
    return json(200, {
      data: {
        path: 'big.md',
        frontmatter: server.frontmatter,
        body: server.file.slice(FRONTMATTER.length),
        content: server.file,
        hash: server.hash,
      },
    });
  }
  if (method === 'PUT' && /\/artifacts\/patch\/big\.md\/content$/.test(url)) {
    if (server.conflict) {
      return json(409, { error: { code: 'PATCH_CONFLICT', message: 'hash mismatch', currentHash: 'other' } });
    }
    const { content } = JSON.parse(String(init!.body)) as { content: string };
    server.file = content;
    server.hash = 'h2';
    // ArtifactWriteResponse: address, new hash, frontmatter as it now stands — no body/content echo.
    return json(200, { data: { path: 'big.md', hash: 'h2', frontmatter: server.frontmatter } });
  }
  if (method === 'PATCH' && /\/artifacts\/patch\/big\.md\/frontmatter$/.test(url)) {
    const { frontmatter } = JSON.parse(String(init!.body)) as { frontmatter: Record<string, unknown> };
    server.frontmatter = { ...server.frontmatter, ...frontmatter };
    return json(200, { data: { path: 'big.md', hash: 'h3', frontmatter: server.frontmatter } });
  }
  if (method === 'POST' && /\/artifacts\/patch\/big\.md\/threads$/.test(url)) {
    return json(201, { data: { threadId: 'thread-new' } });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: url } });
}

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function render() {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(PatchDetail, { patchPath: 'big.md' })));
  });
  // The detail query resolves, then the editor's seed effect runs.
  for (let i = 0; i < 5; i++) await flush();
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) ?? null;
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
  for (let i = 0; i < 3; i++) await flush();
}
/** A user edit, then the autosave debounce and the PUT it fires. */
async function editAndAutosave(md: string) {
  await act(async () => {
    h.editor!.type(md);
  });
  for (let i = 0; i < 5; i++) await flush(10);
}
const docText = () => host.querySelector('[data-testid="patch-editor-doc"]')?.textContent ?? '';
const puts = () => server.calls.filter((c) => c.method === 'PUT');
const detailReads = () =>
  server.calls.filter((c) => c.method === 'GET' && /\/artifacts\/patch\/big\.md$/.test(c.url));

beforeEach(() => {
  server.file = FRONTMATTER + BODY;
  server.hash = 'h1';
  server.frontmatter = {
    type: 'patch',
    brief: 'v1-to-v2.md',
    patch_kind: 'drift',
    created_at: '2026-10-01T10:00:00.000Z',
    created_by: 'agent',
  };
  server.calls = [];
  server.conflict = false;
  h.editor = null;
  h.chat = { threadId: null, open: false };
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  qc.clear();
  vi.unstubAllGlobals();
});

describe('PatchDetail (/patches/$)', () => {
  it('[entity:patch-page] default state: header with kind and pending badge, brief link, settings popover whose applied toggle states that the agent can only set the flag and the user unsets it, the artifact panel loading the whole patch from the default projection, autosave, the 409 banner with only "Reload", and the "Change spec according to patch" action', async () => {
    expect(server.file.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    await render();

    // Header: title (the body's first heading), kind, pending (no `applied` key), brief link.
    const header = host.querySelector('header')!;
    expect(header.textContent).toContain('Drift in M23');
    expect(header.textContent).toContain('drift');
    expect(header.textContent).toContain('pending ⏳');
    expect(host.querySelector('[data-testid="brief-link"]')?.textContent).toContain('v1-to-v2.md');

    // Artifact panel: the editor holds the whole body, read from the default projection.
    expect(detailReads().length).toBeGreaterThan(0);
    for (const r of server.calls.filter((c) => c.method === 'GET')) {
      expect(r.url).not.toContain('view=');
      expect(r.url).not.toContain('range=');
    }
    expect(docText()).toBe(BODY);

    // Autosave: PUT …/content with { content, expectedHash }, frontmatter carried through unchanged.
    await editAndAutosave(`EDITED\n\n${h.editor!.doc}`);
    expect(puts()).toHaveLength(1);
    const sent = JSON.parse(puts()[0]!.body!) as { content: string; expectedHash: string };
    expect(sent.expectedHash).toBe('h1');
    expect(sent.content).toBe(`${FRONTMATTER}EDITED\n\n${BODY}`);
    // The save does not re-download the whole patch: the detail cache is written
    // from the sent content + the PUT's hash, so no detail GET follows the PUT.
    const putAt = server.calls.findIndex((c) => c.method === 'PUT');
    expect(
      server.calls.slice(putAt + 1).filter((c) => c.method === 'GET' && /\/artifacts\/patch\/big\.md$/.test(c.url)),
    ).toHaveLength(0);
    expect(docText()).toBe(`EDITED\n\n${BODY}`);

    // 409 PATCH_CONFLICT: an inline banner whose only action is "Reload", the file untouched.
    server.conflict = true;
    await editAndAutosave(`AGAIN\n\n${h.editor!.doc}`);
    const banner = Array.from(host.querySelectorAll('span')).find((s) =>
      s.textContent?.includes('Patch was modified elsewhere'),
    )?.parentElement;
    expect(banner).toBeDefined();
    expect(Array.from(banner!.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(['Reload']);
    // The second save carried the hash the first PUT answered (cache written, not refetched).
    expect(JSON.parse(puts()[1]!.body!).expectedHash).toBe('h2');
    expect(server.file).toBe(`${FRONTMATTER}EDITED\n\n${BODY}`);
    server.conflict = false;

    // Settings popover → the boolean toggle, and who else writes the flag.
    expect(host.textContent).not.toContain('Patch settings');
    await click(host.querySelector('button[title="Patch settings"]'));
    expect(host.textContent).toContain('Patch settings');
    const note = host.querySelector('[data-testid="patch-applied-agent-note"]')?.textContent ?? '';
    expect(note).toContain('You set both values here');
    expect(note).toMatch(/agent can only mark it applied/);
    expect(note).toContain('mark_patch_applied');
    expect(note).toMatch(/unsetting it stays with you/);
    expect(host.textContent).not.toMatch(/no agent channel/i);
    await click(button('Mark as applied'));
    const patchCall = server.calls.find((c) => c.method === 'PATCH')!;
    expect(patchCall.url).toMatch(/\/artifacts\/patch\/big\.md\/frontmatter$/);
    expect(JSON.parse(patchCall.body!)).toEqual({ frontmatter: { applied: true } });

    // The action at the bottom opens the chat overlay on a new patch thread.
    await click(button('Change spec according to patch'));
    expect(server.calls.filter((c) => c.method === 'POST' && /\/threads$/.test(c.url))).toHaveLength(1);
    expect(h.chat).toEqual({ threadId: 'thread-new', open: true });
  });

  it('[entity:patch-page] applied patch: applied badge, and the toggle offers to unset it (user-driven)', async () => {
    server.frontmatter = { ...server.frontmatter, applied: true };
    await render();
    expect(host.querySelector('header')!.textContent).toContain('applied ✅');
    await click(host.querySelector('button[title="Patch settings"]'));
    await click(button('Mark as pending'));
    const patchCall = server.calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patchCall.body!)).toEqual({ frontmatter: { applied: false } });
  });

  it('[ac:ac-patch-dluzszy-niz-budzet-odpowiedzi-w] a patch longer than the response budget shows on /patches/$ with its last line', async () => {
    expect(server.file.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    await render();
    // The read is the default projection — no view, no window.
    const reads = server.calls.filter((c) => c.method === 'GET');
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.url).not.toContain('view=');
      expect(r.url).not.toContain('range=');
    }
    const shown = docText();
    expect(shown.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    expect(shown.trimEnd().split('\n').at(-1)).toBe(LAST);
  });

  it('[ac:ac-po-autozapisie-patcha-dluzszego-niz-b] after autosave of a patch longer than the response budget the file still ends with its last line', async () => {
    await render();
    await editAndAutosave(`EDITED FIRST LINE\n\n${h.editor!.doc}`);
    expect(puts()).toHaveLength(1);
    const sent = JSON.parse(puts()[0]!.body!) as { content: string };
    expect(sent.content.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    // The file the server now holds: the edit at the top, and the tail intact.
    expect(server.file).toBe(sent.content);
    expect(server.file).toContain('EDITED FIRST LINE');
    expect(server.file.trimEnd().split('\n').at(-1)).toBe(LAST);
    expect(server.file).toBe(`${FRONTMATTER}EDITED FIRST LINE\n\n${BODY}`);
  });
});
