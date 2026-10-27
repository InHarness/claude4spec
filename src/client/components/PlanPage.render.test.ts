// @vitest-environment happy-dom
/**
 * The plan page at `/plans/$slug` (M10, ui-view `plan-page`).
 *
 * 2.1.28 (M10 Host UI Kit slice `0dy3js11`): the footer is the catalog
 * `ActionBar` — M10 hands it the Save / Discard / Analyse plan / Run plan
 * action descriptions, it draws no sticky bar of its own. The threads panel and
 * the plan file's version history are the slice's two recorded DŁUG entries —
 * the host `ArtifactThreadsPanel` and `FileVersionHistory`.
 *
 * 2.1.48 (M10 + M36 `r2nekhf5`): the artifact panel (`<PlanEditor />`) loads
 * the WHOLE plan from the detail route's default projection whatever its
 * length, Save writes the whole file back, and a `409 PLAN_CONFLICT` shows an
 * inline banner whose only action is "Reload" — no "Override", nothing written.
 *
 * The real `PlanPage`, `PlanEditor`, `usePlan` hooks and `useArtifactVersions`
 * run; `fetch` (the server), tiptap's React binding (a document held as a
 * markdown string — happy-dom cannot host ProseMirror's selectors) and the
 * editor's chrome (outline, annotation bubble) are fakes. The plan is LONGER
 * than the response budget, so "the whole file" is proven by its last line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActionBarProps } from '../host-ui-kit/actions/ActionBar.js';
import { DEFAULT_BUDGET_CHARS } from '../../server/discovery/budget.js';

interface FakeEditor {
  doc: string;
  isDestroyed: boolean;
  opts: { editable?: boolean; onUpdate?: (p: { editor: FakeEditor }) => void };
  storage: { markdown: { getMarkdown: () => string } } & Record<string, unknown>;
  commands: { setContent: (md: string, emit?: boolean) => void };
  view: object;
  subscribe: (fn: () => void) => () => void;
  /** A user edit: the document changes and tiptap reports it. */
  type: (md: string) => void;
}

const h = vi.hoisted(() => ({
  actionBars: [] as ActionBarProps[],
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
      view: {},
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

vi.mock('../host-ui-kit/actions/ActionBar.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../host-ui-kit/actions/ActionBar.js')>();
  return {
    ActionBar: (props: ActionBarProps) => {
      // React dev may call a component without props (component stack) — record only real renders.
      if (props && Array.isArray(props.actions)) h.actionBars.push(props);
      return createElement(real.ActionBar, props);
    },
  };
});
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
      return React.createElement('div', { 'data-testid': 'plan-editor-doc' }, doc);
    },
  };
});
vi.mock('../tiptap/registrations.js', () => ({}));
vi.mock('../tiptap/EditorFactory.js', () => ({ EditorFactory: { buildExtensions: () => [] } }));
vi.mock('../tiptap/slashInvoke.js', () => ({ invokeSlash: () => {} }));
vi.mock('../tiptap/registry.js', () => ({
  assertSaveMode: () => ({ mode: 'explicit' }),
  getContextSpec: () => ({}),
  getEditorSchemaVersion: () => 0,
  subscribeEditorSchema: () => () => {},
}));
vi.mock('../tiptap/extensions/AnnotationHighlight.js', () => ({ refreshAnnotations: () => {} }));
vi.mock('../tiptap/AnnotationBubble.js', () => ({ AnnotationBubble: () => null }));
vi.mock('./OutlineFloater.js', () => ({ OutlineFloater: () => null }));
vi.mock('../hooks/usePagesIndex.js', () => ({ usePagesIndex: () => null }));
vi.mock('../hooks/useScrollToAnchor.js', () => ({ useScrollToAnchor: () => {} }));
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
vi.mock('../state/chat.js', () => {
  const state = { annotations: [], setChatThreadId: () => {}, setChatOpen: () => {} };
  return { useChatStore: Object.assign((sel: (s: unknown) => unknown) => sel(state), { getState: () => state }) };
});
vi.mock('../state/outline.js', () => {
  const state = { editor: null, outlineOpen: false, setEditor: () => {} };
  return { useOutlineStore: Object.assign((sel: (s: unknown) => unknown) => sel(state), { getState: () => state }) };
});
vi.mock('../chat/chatPrefill.js', () => ({ requestChatPrefill: () => {} }));
vi.mock('../tiptap/unsavedEdits.js', () => ({ useUnsavedEditsSource: () => {} }));
vi.mock('./OutlineButton.js', () => ({ OutlineButton: () => null }));
vi.mock('./ArtifactThreadsPanel.js', () => ({
  ArtifactThreadsPanel: () => createElement('div', { 'data-testid': 'artifact-threads-panel' }),
}));
vi.mock('./FileVersionHistory.js', () => ({
  FileVersionHistory: (props: { kind?: string; path?: string }) =>
    createElement('div', { 'data-testid': 'file-version-history', 'data-kind': props?.kind }, props?.path),
}));

import { PlanPage } from './PlanPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LAST = 'LAST LINE OF THE PLAN';
const FRONTMATTER = '---\ntype: plan\ntitle: My plan\ncreated_at: 2026-10-23T00:00:00.000Z\napplied: false\n---\n';
const LONG_BODY =
  'Step 0: start here.\n\n' +
  Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `Step ${i + 1} ${'x'.repeat(40)}`).join('\n\n') +
  `\n\n${LAST}\n`;

/**
 * The server: one plan file, served by the detail route's default projection
 * and written by the content route with the real guard — a stale
 * `expectedHash` is `409 PLAN_CONFLICT` and the file is left alone.
 */
const server = {
  file: '',
  hash: 'h1',
  /** One `file_version` row per content save. */
  versions: 3,
  /** The next content PUT fails with a plain 500 (not a conflict). */
  failPut: false,
  /** The plan's `applied` flag, written by the frontmatter route. */
  applied: false,
  calls: [] as Array<{ method: string; url: string; body?: string }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fakeFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? 'GET';
  server.calls.push({ method, url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
  const frontmatter = { type: 'plan', title: 'My plan', created_at: '2026-10-23T00:00:00.000Z', applied: server.applied };
  if (method === 'PATCH' && /\/artifacts\/plan\/my-plan\.md\/frontmatter$/.test(url)) {
    const sent = JSON.parse(String(init!.body)) as { frontmatter: { applied?: boolean } };
    if (typeof sent.frontmatter.applied === 'boolean') server.applied = sent.frontmatter.applied;
    server.hash = `${server.hash}+`;
    return json(200, { data: { path: 'my-plan.md', hash: server.hash, frontmatter: { ...frontmatter, applied: server.applied } } });
  }
  if (method === 'GET' && /\/artifacts\/plan\/my-plan\.md(\?.*)?$/.test(url)) {
    return json(200, {
      data: { path: 'my-plan.md', frontmatter, body: server.file.slice(FRONTMATTER.length), content: server.file, hash: server.hash },
    });
  }
  if (method === 'GET' && /\/artifacts\/plan\/my-plan\.md\/versions$/.test(url)) {
    return json(200, {
      data: Array.from({ length: server.versions }, (_, i) => ({ version: server.versions - i })),
    });
  }
  if (method === 'GET' && /\/plans\/my-plan\.md\/last-thread$/.test(url)) {
    return json(200, { data: { threadId: null } });
  }
  if (method === 'PUT' && /\/artifacts\/plan\/my-plan\.md\/content$/.test(url)) {
    if (server.failPut) {
      server.failPut = false;
      return json(500, { error: { code: 'INTERNAL', message: 'Disk unavailable' } });
    }
    const { content, expectedHash } = JSON.parse(String(init!.body)) as { content: string; expectedHash: string };
    if (expectedHash !== server.hash) {
      return json(409, {
        error: { code: 'PLAN_CONFLICT', message: 'plan changed since last read' },
        currentHash: server.hash,
        currentContent: server.file,
      });
    }
    server.file = content;
    server.hash = `${server.hash}+`;
    server.versions += 1;
    return json(200, { data: { path: 'my-plan.md', hash: server.hash, frontmatter } });
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
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(PlanPage, { planPath: 'my-plan.md' })));
  });
  // The detail query resolves, then the editor's seed effect (a microtask) runs.
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
  for (let i = 0; i < 5; i++) await flush();
}
async function type(md: string) {
  await act(async () => {
    h.editor!.type(md);
  });
}
const lastBar = () => h.actionBars[h.actionBars.length - 1];
/** The sticky footer the catalog ActionBar draws. */
const stickyBar = () =>
  Array.from(host.querySelectorAll<HTMLElement>('div')).find((d) => d.style.position === 'sticky') ?? null;
const docText = () => host.querySelector('[data-testid="plan-editor-doc"]')?.textContent ?? '';
const detailGets = () =>
  server.calls.filter((c) => c.method === 'GET' && /\/artifacts\/plan\/my-plan\.md(\?.*)?$/.test(c.url));
const versionGets = () => server.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/versions'));
const puts = () => server.calls.filter((c) => c.method === 'PUT');
const banner = () => host.querySelector<HTMLElement>('[data-testid="plan-conflict-banner"]');
/** An edit of the first line — the rest of the document, its last line included, untouched. */
const editedBody = () => docText().replace('Step 0: start here.', 'Step 0: start somewhere else.');

beforeEach(() => {
  server.file = FRONTMATTER + 'Step 1: do the thing.\n';
  server.hash = 'h1';
  server.versions = 3;
  server.failPut = false;
  server.applied = false;
  server.calls = [];
  h.actionBars = [];
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

describe('[section:0dy3js11] M10 Host UI Kit slice — plan-page footer is the catalog ActionBar', () => {
  it('[section:0dy3js11] a saved, non-empty plan renders its footer through the catalog ActionBar with Analyse plan and Run plan (Run primary)', async () => {
    await render();
    expect(h.actionBars.length).toBeGreaterThan(0);
    const bar = lastBar()!;
    expect(bar.actions.map((a) => a.label)).toEqual(['Analyse plan', 'Run plan']);
    expect(bar.actions.find((a) => a.label === 'Run plan')?.variant).toBe('primary');
    expect(bar.status).toBeUndefined();
    // The buttons are drawn inside the catalog's sticky bar, not by page markup.
    const sticky = stickyBar();
    expect(sticky).not.toBeNull();
    expect(sticky!.contains(button('Run plan'))).toBe(true);
    expect(sticky!.contains(button('Analyse plan'))).toBe(true);
    // Exactly one sticky bar on the page — the ActionBar's.
    expect(Array.from(host.querySelectorAll<HTMLElement>('div')).filter((d) => d.style.position === 'sticky')).toHaveLength(1);
  });

  it('[section:0dy3js11] unsaved edits add Discard and Save to the same ActionBar, with the status slot', async () => {
    await render();
    await type('Step 1: do another thing.\n');
    const bar = lastBar()!;
    expect(bar.actions.map((a) => a.label)).toEqual(['Discard', 'Save', 'Analyse plan', 'Run plan']);
    expect(bar.status).toBe('Unsaved changes');
    const sticky = stickyBar()!;
    expect(sticky.contains(button('Save'))).toBe(true);
    expect(sticky.contains(button('Discard'))).toBe(true);
    expect(sticky.textContent).toContain('Unsaved changes');
  });

  it('[section:0dy3js11] an empty plan has nothing to act on, so no footer is rendered', async () => {
    server.file = `${FRONTMATTER}   \n`;
    await render();
    expect(h.actionBars).toHaveLength(0);
    expect(stickyBar()).toBeNull();
    expect(button('Run plan')).toBeNull();
  });

  it('[section:0dy3js11] the threads panel and the plan file version history stay the host DŁUG components (ArtifactThreadsPanel, FileVersionHistory)', async () => {
    await render();
    await click(button('Threads'));
    expect(host.querySelector('[data-testid="artifact-threads-panel"]')).not.toBeNull();
    await click(button('History'));
    const history = host.querySelector('[data-testid="file-version-history"]');
    expect(history).not.toBeNull();
    expect(history!.getAttribute('data-kind')).toBe('plan');
  });
});

describe('PlanPage (/plans/$slug) — the applied flag in the header', () => {
  it('[ac:ac-header-plans-slug-niesie-badge-applie] the plan page header shows the applied badge, and it is the only place from which the user turns it back to pending', async () => {
    server.applied = true;
    await render();
    const header = () => host.querySelector('header')!;
    expect(header().textContent).toContain('applied ✅');

    // The badge in the header is the toggle: a click unsets the flag through the frontmatter route.
    const toggle = Array.from(header().querySelectorAll('button')).find((b) => b.textContent?.includes('applied ✅'));
    expect(toggle?.getAttribute('title')).toMatch(/click to mark pending again/);
    await click(toggle ?? null);
    const patches = server.calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toMatch(/\/api\/artifacts\/plan\/my-plan\.md\/frontmatter$/);
    expect(JSON.parse(patches[0]!.body!)).toEqual({ frontmatter: { applied: false } });
    expect(header().textContent).toContain('pending ⏳');

    // The only place: the hook that writes the plan's flag from the UI has exactly one consumer — this header.
    const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const consumers = (fs.readdirSync(clientDir, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => fs.readFileSync(path.join(clientDir, f), 'utf-8').includes('useSetPlanApplied('))
      .map((f) => f.split(path.sep).join('/'))
      .sort();
    expect(consumers).toEqual(['components/PlanPage.tsx', 'hooks/usePlan.ts']);
  });
});

describe('PlanPage (/plans/$slug) — the whole plan file, Save and the 409 banner (2.1.48)', () => {
  beforeEach(() => {
    server.file = FRONTMATTER + LONG_BODY;
  });

  it('[entity:plan-page] header (title, Plan v{N}, applied badge), the artifact panel loading the whole plan from the default projection, Save/Discard only when dirty, the 409 banner with only "Reload", and the Threads / History panels', async () => {
    expect(server.file.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    await render();

    // Header: the title, the read-only version badge from the newest file_version row, pending.
    const header = host.querySelector('header')!;
    expect(header.textContent).toContain('My plan');
    expect(header.textContent).toContain('Plan v3');
    expect(header.textContent).toContain('pending');

    // Artifact panel: the default projection (no view, no range) — the whole file.
    expect(detailGets()).toHaveLength(1);
    expect(detailGets()[0]!.url).toMatch(/\/api\/artifacts\/plan\/my-plan\.md$/);
    expect(docText()).toBe(LONG_BODY);
    expect(lastBar()!.actions.map((a) => a.label)).toEqual(['Analyse plan', 'Run plan']);

    // Dirty → Save / Discard; Save writes the whole file and makes a new version.
    await type(editedBody());
    expect(lastBar()!.actions.map((a) => a.label)).toEqual(['Discard', 'Save', 'Analyse plan', 'Run plan']);
    await click(button('Save'));
    expect(puts()).toHaveLength(1);
    expect(server.file).toBe(FRONTMATTER + LONG_BODY.replace('Step 0: start here.', 'Step 0: start somewhere else.'));
    expect(button('Save')).toBeNull();
    expect(host.querySelector('header')!.textContent).toContain('Plan v4');

    // Somebody else writes the file; the next Save is refused with the banner.
    server.file = `${FRONTMATTER}Rewritten elsewhere.\n`;
    server.hash = 'foreign';
    await type(docText().replace('Step 1 ', 'Step one '));
    await click(button('Save'));
    expect(banner()).not.toBeNull();
    expect(Array.from(banner()!.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(['Reload']);

    // Threads / History panels.
    await click(button('Threads'));
    expect(host.querySelector('[data-testid="artifact-threads-panel"]')).not.toBeNull();
    await click(button('History'));
    expect(host.querySelector('[data-testid="file-version-history"]')!.getAttribute('data-kind')).toBe('plan');
  });

  it('[entity:wklad-do-edytora-m10] <PlanEditor /> is the artifact panel of /plans/:slug, beside the Threads and Version history panels', async () => {
    await render();
    // The Plan view is the artifact panel: the PlanEditor's document, seeded from the file's body.
    expect(host.querySelector('[data-testid="plan-editor-doc"]')).not.toBeNull();
    expect(docText()).toBe(LONG_BODY);
    // The same screen switches between the three panels — Plan, Threads, History.
    expect(['Plan', 'Threads', 'History'].map((l) => button(l) !== null)).toEqual([true, true, true]);
    await click(button('Threads'));
    expect(host.querySelector('[data-testid="artifact-threads-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="plan-editor-doc"]')).toBeNull();
    await click(button('History'));
    const history = host.querySelector('[data-testid="file-version-history"]')!;
    expect(history.getAttribute('data-kind')).toBe('plan');
    expect(history.textContent).toBe('my-plan.md');
    await click(button('Plan'));
    expect(docText()).toBe(LONG_BODY);
  });

  it('[ac:ac-plan-dluzszy-niz-budzet-odpowiedzi-wy] a plan longer than the response budget is shown on /plans/$slug with the last line of the file', async () => {
    expect(server.file.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    await render();
    // Read from the default projection — no `view=operation`, no `range` window.
    expect(detailGets().map((c) => c.url)).toEqual(['/api/artifacts/plan/my-plan.md']);
    expect(docText().length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    expect(docText().trimEnd().split('\n').at(-1)).toBe(LAST);
    expect(host.textContent).toContain(LAST);
  });

  it('[ac:ac-po-save-planu-dluzszego-niz-budzet-od] after Save of a plan longer than the response budget the file still holds its last line', async () => {
    await render();
    await type(editedBody());
    await click(button('Save'));

    expect(puts()).toHaveLength(1);
    const sent = JSON.parse(puts()[0]!.body!) as { content: string; expectedHash: string };
    // The whole file: the frontmatter block it was read with + the whole edited body.
    expect(sent.expectedHash).toBe('h1');
    expect(sent.content.startsWith(FRONTMATTER)).toBe(true);
    expect(sent.content).toContain('Step 0: start somewhere else.');
    expect(sent.content.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
    expect(server.file.trimEnd().split('\n').at(-1)).toBe(LAST);
    // The screen keeps the saved file — written into the cache from the save, not refetched.
    expect(detailGets()).toHaveLength(1);
    expect(docText().trimEnd().split('\n').at(-1)).toBe(LAST);
    // The next Save is based on the hash the PUT answered: no spurious conflict.
    await type(docText().replace('Step 1 ', 'Step one '));
    await click(button('Save'));
    expect(puts()).toHaveLength(2);
    expect(JSON.parse(puts()[1]!.body!).expectedHash).toBe('h1+');
    expect(banner()).toBeNull();
    expect(server.file.trimEnd().split('\n').at(-1)).toBe(LAST);
  });

  it('[ac:ac-save-planu-zmienionego-w-miedzyczasie] Save of a plan changed on disk meanwhile shows an inline banner with the "Reload" action; the file is not overwritten', async () => {
    await render();
    await type(editedBody());
    // The file changes on disk after the editor read it.
    const foreign = `${FRONTMATTER}Rewritten on disk.\n\n${LAST}\n`;
    server.file = foreign;
    server.hash = 'on-disk';
    await click(button('Save'));

    // Inline banner (in the page, not a dialog) whose only action is "Reload".
    const b = banner();
    expect(b).not.toBeNull();
    expect(b!.getAttribute('role')).toBe('alert');
    expect(host.contains(b)).toBe(true);
    expect(b!.textContent).toContain('modified elsewhere');
    expect(Array.from(b!.querySelectorAll('button')).map((x) => x.textContent?.trim())).toEqual(['Reload']);
    expect(button('Override')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Refused: the file is byte-identical and the edit is still in the editor.
    expect(server.file).toBe(foreign);
    expect(docText()).toContain('Step 0: start somewhere else.');

    // Reload: the latest file replaces the buffer; the banner and Save go away.
    await click(button('Reload'));
    expect(detailGets()).toHaveLength(2);
    expect(docText()).toBe(`Rewritten on disk.\n\n${LAST}\n`);
    expect(banner()).toBeNull();
    expect(button('Save')).toBeNull();
    expect(puts()).toHaveLength(1);
    expect(server.file).toBe(foreign);
  });

  it('[entity:plan-page] the conflict banner replaces an earlier failure\'s error, and Reload leaves no stale error behind', async () => {
    await render();
    await type(editedBody());
    // An earlier Save fails for another reason: its error is shown.
    server.failPut = true;
    await click(button('Save'));
    expect(host.textContent).toContain('Disk unavailable');
    expect(banner()).toBeNull();

    // The file changes on disk; the retry is refused: only the banner remains.
    server.file = `${FRONTMATTER}Rewritten on disk.\n`;
    server.hash = 'on-disk';
    await click(button('Save'));
    expect(banner()).not.toBeNull();
    expect(host.textContent).not.toContain('Disk unavailable');

    // Reload replaces the buffer: no banner, no error.
    await click(button('Reload'));
    expect(banner()).toBeNull();
    expect(host.textContent).not.toContain('Disk unavailable');
    expect(docText()).toBe('Rewritten on disk.\n');
  });

  it('[entity:wklad-do-edytora-m10#`plan`] always editable; Save only when dirty, saving the whole content as a new file_version; Discard reverts to the last saved version; a 409 shows an inline banner with only "Reload", no "Override", the file not overwritten', async () => {
    await render();
    // Always editable — no read-only mode, no "Edit" toggle.
    expect(h.editor!.opts.editable).not.toBe(false);
    expect(button('Edit')).toBeNull();
    // Save only when dirty.
    expect(button('Save')).toBeNull();
    expect(button('Discard')).toBeNull();

    // Discard reverts to the last saved version.
    await type(editedBody());
    expect(button('Save')).not.toBeNull();
    await click(button('Discard'));
    expect(docText()).toBe(LONG_BODY);
    expect(button('Save')).toBeNull();
    expect(puts()).toHaveLength(0);

    // Save writes the whole content; each save is a new file_version.
    const versionsBefore = server.versions;
    const versionReads = versionGets().length;
    await type(editedBody());
    await click(button('Save'));
    expect(JSON.parse(puts()[0]!.body!).content).toBe(
      FRONTMATTER + LONG_BODY.replace('Step 0: start here.', 'Step 0: start somewhere else.'),
    );
    expect(server.versions).toBe(versionsBefore + 1);
    expect(versionGets().length).toBeGreaterThan(versionReads);
    expect(host.querySelector('header')!.textContent).toContain(`Plan v${versionsBefore + 1}`);
    // The saved text is now the base Discard returns to.
    await type(docText().replace('Step 1 ', 'Step one '));
    await click(button('Discard'));
    expect(docText()).toContain('Step 0: start somewhere else.');
    expect(docText()).not.toContain('Step one ');

    // A hash conflict: banner with only "Reload", no "Override", nothing written.
    const foreign = `${FRONTMATTER}Changed by somebody else.\n`;
    server.file = foreign;
    server.hash = 'other';
    await type(docText().replace('Step 2 ', 'Step two '));
    await click(button('Save'));
    expect(Array.from(banner()!.querySelectorAll('button')).map((x) => x.textContent?.trim())).toEqual(['Reload']);
    expect(button('Override')).toBeNull();
    expect(server.file).toBe(foreign);
    expect(server.versions).toBe(versionsBefore + 1);
  });
});
