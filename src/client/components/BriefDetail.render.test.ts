// @vitest-environment happy-dom
/**
 * 2.1.48 (M21, ui-view `brief-page`) — the brief page at `/briefs/$`: header
 * (path, provenance badge, from → to, implemented/pending), the Settings
 * popover with the `implemented` toggle and the immutable keys, the artifact
 * panel whose editor loads the WHOLE brief from the detail route's default
 * projection whatever its length, the autosave that writes the whole file back,
 * the `409 BRIEF_CONFLICT` banner whose only action is "Reload", and the
 * Threads / History panels. The entity lists no extra `states`.
 *
 * The real `BriefDetail`, `BriefEditor`, `useBriefs` hooks and `briefsApi` run;
 * only `fetch` (the server) and tiptap's React binding (a document held as a
 * markdown string — happy-dom cannot host ProseMirror's selectors) are fakes.
 * Every brief here is LONGER than the response budget, so "the whole file" is
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
      return React.createElement('div', { 'data-testid': 'brief-editor-doc' }, doc);
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
  useChatStore: (sel: (s: unknown) => unknown) => sel({ setChatThreadId: () => {}, setChatOpen: () => {} }),
}));
vi.mock('./ArtifactThreadsPanel.js', () => ({
  ArtifactThreadsPanel: (props: { title?: string }) =>
    createElement('div', { 'data-testid': 'artifact-threads-panel' }, props?.title),
}));
vi.mock('./FileVersionHistory.js', () => ({
  FileVersionHistory: (props: { kind?: string; path?: string }) =>
    createElement('div', { 'data-testid': 'file-version-history' }, `${props?.kind}:${props?.path}`),
}));
vi.mock('./BriefsList.js', () => ({
  ImplementedBadge: (props: { implemented?: boolean }) =>
    createElement('span', null, props?.implemented ? 'implemented: ✅' : 'pending: ⏳'),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: unknown }) => createElement('a', null, props?.children as never),
}));

import { BriefDetail } from './BriefDetail.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LAST = 'LAST LINE OF THE BRIEF';
const FRONTMATTER =
  '---\ntype: brief\nfrom_release: null\nto_release: 2.1.48\ngenerated_at: 2026-10-23T00:00:00.000Z\nimplemented: false\n---\n';
const BODY =
  Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `Line ${i} ${'x'.repeat(40)}`).join('\n\n') +
  `\n\n${LAST}\n`;

/** The server: one brief file, served by the detail route's default projection, written by the content route. */
const server = {
  file: '',
  hash: 'h1',
  calls: [] as Array<{ method: string; url: string; body?: string }>,
  conflict: false,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fakeFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? 'GET';
  server.calls.push({ method, url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
  if (method === 'GET' && /\/artifacts\/brief\/big\.md$/.test(url)) {
    return json(200, {
      data: {
        path: 'big.md',
        frontmatter: { type: 'brief', from_release: null, to_release: '2.1.48', generated_at: '2026-10-23', implemented: false },
        body: server.file.slice(FRONTMATTER.length),
        content: server.file,
        hash: server.hash,
      },
    });
  }
  if (method === 'PUT' && /\/artifacts\/brief\/big\.md\/content$/.test(url)) {
    if (server.conflict) {
      return json(409, { error: { code: 'BRIEF_CONFLICT', message: 'hash mismatch', currentHash: 'other' } });
    }
    const { content } = JSON.parse(String(init!.body)) as { content: string };
    server.file = content;
    server.hash = 'h2';
    // ArtifactWriteResponse: address, new hash, frontmatter as it now stands — no body/content echo.
    return json(200, {
      data: {
        path: 'big.md',
        hash: 'h2',
        frontmatter: { type: 'brief', from_release: null, to_release: '2.1.48', generated_at: '2026-10-23', implemented: false },
      },
    });
  }
  if (method === 'PATCH' && /\/frontmatter$/.test(url)) return json(200, { data: { path: 'big.md', hash: 'h3' } });
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
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(BriefDetail, { briefPath: 'big.md' })));
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
}
/** A user edit, then the autosave debounce and the PUT it fires. */
async function editAndAutosave(md: string) {
  await act(async () => {
    h.editor!.type(md);
  });
  for (let i = 0; i < 5; i++) await flush(10);
}
const docText = () => host.querySelector('[data-testid="brief-editor-doc"]')?.textContent ?? '';
const puts = () => server.calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  server.file = FRONTMATTER + BODY;
  server.hash = 'h1';
  server.calls = [];
  server.conflict = false;
  h.editor = null;
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

describe('BriefDetail (/briefs/$)', () => {
  it('[entity:brief-page] header badges and settings popover, the artifact panel loading the whole brief from the default projection, autosave, the 409 banner with only "Reload", and the Threads / History panels', async () => {
    expect(server.file.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    await render();

    // Header: path, provenance (`initial` for an empty from_release), → to, pending.
    const header = host.querySelector('header')!;
    expect(header.textContent).toContain('big.md');
    expect(header.textContent).toContain('initial');
    expect(header.textContent).toContain('2.1.48');
    expect(header.textContent).toContain('pending: ⏳');

    // Settings popover: the implemented toggle is the only mutable key; the rest are read-only.
    await click(host.querySelector('button[title="Brief settings"]'));
    expect(host.textContent).toContain('Immutable');
    expect(host.textContent).toContain('from_release: (initial)');
    expect(host.textContent).toContain('to_release: 2.1.48');
    await click(button('Mark as implemented'));
    for (let i = 0; i < 3; i++) await flush();
    const patch = server.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/artifacts\/brief\/big\.md\/frontmatter$/);
    expect(JSON.parse(patch.body!)).toEqual({ frontmatter: { implemented: true } });

    // Artifact panel: the editor holds the whole body, read from the default projection.
    const reads = server.calls.filter((c) => c.method === 'GET');
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.url).toMatch(/\/artifacts\/brief\/big\.md$/);
    expect(docText()).toBe(BODY);

    // Autosave: PUT …/content with { content, expectedHash }, frontmatter carried through unchanged.
    await editAndAutosave(`EDITED\n\n${h.editor!.doc}`);
    expect(puts()).toHaveLength(1);
    const sent = JSON.parse(puts()[0]!.body!) as { content: string; expectedHash: string };
    expect(sent.expectedHash).toBe('h1');
    expect(sent.content.startsWith(FRONTMATTER)).toBe(true);
    // The save does not re-download the whole brief: the detail cache is written
    // from the sent content + the PUT's hash, so no detail GET follows the PUT.
    const putAt = server.calls.findIndex((c) => c.method === 'PUT');
    expect(
      server.calls.slice(putAt + 1).filter((c) => c.method === 'GET' && /\/artifacts\/brief\/big\.md$/.test(c.url)),
    ).toHaveLength(0);
    expect(docText()).toBe(`EDITED\n\n${BODY}`);

    // 409 BRIEF_CONFLICT: an inline banner whose only action is "Reload".
    server.conflict = true;
    await editAndAutosave(`AGAIN\n\n${h.editor!.doc}`);
    const banner = Array.from(host.querySelectorAll('span')).find((s) =>
      s.textContent?.includes('Brief was modified elsewhere'),
    )?.parentElement;
    expect(banner).toBeDefined();
    expect(Array.from(banner!.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(['Reload']);
    // The second save carried the hash the first PUT answered (cache written, not refetched).
    expect(JSON.parse(puts()[1]!.body!).expectedHash).toBe('h2');
    // The refused save did not reach the file: it still holds the first save.
    expect(server.file).toBe(`${FRONTMATTER}EDITED\n\n${BODY}`);

    // Threads and History panels.
    await click(button('Threads'));
    expect(host.querySelector('[data-testid="artifact-threads-panel"]')).not.toBeNull();
    await click(button('History'));
    expect(host.querySelector('[data-testid="file-version-history"]')?.textContent).toBe('brief:big.md');
  });

  it('[ac:ac-brief-dluzszy-niz-budzet-odpowiedzi-w] a brief longer than the response budget shows on /briefs/$ with its last line', async () => {
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

  it('[ac:ac-po-autozapisie-briefu-dluzszego-niz-b] after autosave of a brief longer than the response budget the file still ends with its last line', async () => {
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
