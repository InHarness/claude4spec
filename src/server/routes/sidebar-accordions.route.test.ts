import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { RootRegistry } from '../roots/registry.js';
import {
  KIND_DECLARATIONS,
  type RootKind,
  type SidebarDeclaration,
  type SidebarReducer,
} from '../../shared/root-kinds.js';
import type { Root, WsEvent } from '../../shared/types.js';
import { SidebarAccordionsService } from '../services/sidebar-accordions.js';
import { sidebarAccordionsRouter } from './sidebar-accordions.js';

/**
 * 2.1.9 — M02 as the L13 implementor: the sidebar's accordion arrays
 * (`m02l13001` „Reduktory sidebar”, `x6avfb5q` `m02-sidebar-reducer`) and their
 * delivery, `GET /api/sidebar-accordions` (DTO `sidebar-accordion`).
 *
 * No kind declares a reducer today, so the reducer cases put one on a kind for
 * the duration of a test (`withSidebar`) — the implementor reads the kind's
 * declaration at call time, which is exactly the seam the `skills` kind (M52)
 * plugs into.
 */

const USER_ROOTS: Root[] = [
  { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
  { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
];

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-sidebar-'));
  tmpDirs.push(d);
  return d;
}

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function withSidebar<T>(
  overrides: Partial<Record<RootKind, SidebarDeclaration>>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<RootKind, SidebarDeclaration>();
  for (const [kind, sidebar] of Object.entries(overrides) as Array<[RootKind, SidebarDeclaration]>) {
    previous.set(kind, KIND_DECLARATIONS[kind].sidebar);
    KIND_DECLARATIONS[kind].sidebar = sidebar;
  }
  try {
    return await fn();
  } finally {
    for (const [kind, sidebar] of previous) KIND_DECLARATIONS[kind].sidebar = sidebar;
  }
}

function service(cwd: string, events: WsEvent[] = [], opts: { warnings?: string[] } = {}) {
  return new SidebarAccordionsService({
    cwd,
    registry: new RootRegistry(USER_ROOTS),
    ws: { broadcast: (e: WsEvent) => void events.push(e) },
    projectKey: cwd,
    warn: (m) => void opts.warnings?.push(m),
  });
}

/**
 * A reducer of the shape the L13 field allows: one accordion per top-level
 * directory holding an `index.md`, labelled by that file's frontmatter `title`,
 * ordered by its `order`. Input is paths + frontmatter of the glob only.
 */
const PER_DIR: SidebarReducer = {
  glob: '*/index.md',
  reduce: ({ paths, frontmatter }) =>
    paths
      .filter((p) => /^[^/]+\/index\.md$/.test(p))
      .map((p) => ({ dir: p.split('/')[0]!, fm: frontmatter.get(p) ?? {} }))
      .sort((a, b) => Number(a.fm.order ?? 0) - Number(b.fm.order ?? 0))
      .map(({ dir, fm }) => ({ key: dir, label: String(fm.title ?? dir), path: dir })),
};

const SCOPE = 'context:sidebar#1' as const;

describe('2.1.9 — GET /api/sidebar-accordions (M02 jmh3f1fl, m02l13001)', () => {
  it('[entity:get-api-sidebar-accordions] GET /api/sidebar-accordions → 200 { data } — the ordered accordion array of every root; `accordion` roots give one element each, `hidden` roots none, no :rootId segment', async () => {
    const cwd = tmp();
    const app = express().use('/api/sidebar-accordions', sidebarAccordionsRouter(service(cwd)));
    const res = await request(app).get('/api/sidebar-accordions');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(res.body.data).toEqual([
      { rootId: 'pages', key: 'pages', label: 'Pages', path: '' },
      { rootId: 'adr', key: 'adr', label: 'ADRs', path: '' },
    ]);
    // The system roots are `hidden` — they add no element.
    for (const id of ['plans', 'briefs', 'patches', 'entities', 'releases']) {
      expect(res.body.data.some((a: { rootId: string }) => a.rootId === id)).toBe(false);
    }
    // There is no per-root variant of the route.
    expect((await request(app).get('/api/sidebar-accordions/pages')).status).toBe(404);
  });

  it('[entity:sidebar-accordion] every element is { rootId, key, label, path } (all strings, path `\'\'` = whole root); `rootId` + `key` key it uniquely; the minimal example is the `accordion` case of root `pages`', async () => {
    const cwd = tmp();
    put(path.join(cwd, 'pages', 'guides', 'index.md'), '---\ntitle: Guides\norder: 2\n---\n# G\n');
    put(path.join(cwd, 'pages', 'api', 'index.md'), '---\ntitle: API\norder: 1\n---\n# A\n');
    await withSidebar({ plans: 'accordion' }, async () => {
      const res = await request(express().use('/api/sidebar-accordions', sidebarAccordionsRouter(service(cwd)))).get(
        '/api/sidebar-accordions',
      );
      const data = res.body.data as Array<Record<string, unknown>>;
      expect(data[0]).toEqual({ rootId: 'pages', key: 'pages', label: 'Pages', path: '' });
      for (const el of data) {
        expect(Object.keys(el).sort()).toEqual(['key', 'label', 'path', 'rootId']);
        for (const f of ['rootId', 'key', 'label', 'path']) expect(typeof el[f]).toBe('string');
      }
      const ids = data.map((el) => `${el.rootId}\u0000${el.key}`);
      expect(new Set(ids).size).toBe(ids.length);
    });
    // A reducer root: `path` names a subtree, the order is the reducer's.
    await withSidebar({ pages: PER_DIR }, async () => {
      const svc = service(cwd);
      await svc.rebuildAll();
      expect(svc.listAccordions().filter((a) => a.rootId === 'pages')).toEqual([
        { rootId: 'pages', key: 'api', label: 'API', path: 'api' },
        { rootId: 'pages', key: 'guides', label: 'Guides', path: 'guides' },
      ]);
    });
  });
});

describe('2.1.9 — sidebar reducers: call, recompute, fallback, delivery (M02 m02l13001, x6avfb5q)', () => {
  it('orders the array: `pages` roots in registry order first, then the other kinds in registration order; within a root, the reducer\'s order', async () => {
    const cwd = tmp();
    await withSidebar({ releases: 'accordion', plans: 'accordion' }, async () => {
      expect(service(cwd).listAccordions().map((a) => a.rootId)).toEqual(['pages', 'adr', 'plans', 'releases']);
    });
  });

  it('a reducer root not yet computed, and a reducer that throws, get the `accordion` fallback (with a warning)', async () => {
    const cwd = tmp();
    const warnings: string[] = [];
    const failing: SidebarReducer = {
      glob: '**/*.md',
      reduce: () => {
        throw new Error('boom');
      },
    };
    await withSidebar({ pages: failing }, async () => {
      const svc = service(cwd, [], { warnings });
      expect(svc.listAccordions()[0]).toEqual({ rootId: 'pages', key: 'pages', label: 'Pages', path: '' });
      await svc.rebuildAll();
      expect(svc.listAccordions()[0]).toEqual({ rootId: 'pages', key: 'pages', label: 'Pages', path: '' });
      expect(warnings.some((w) => w.includes("root 'pages'") && w.includes('boom'))).toBe(true);
    });
  });

  it('enforces the L13 result rules: an element outside the root, a duplicate key or a later overlapping subtree is skipped with a warning', async () => {
    const cwd = tmp();
    const warnings: string[] = [];
    const sloppy: SidebarReducer = {
      glob: '*/index.md',
      reduce: () => [
        { key: 'a', label: 'A', path: 'a/' },
        { key: 'escape', label: 'X', path: '../outside' },
        { key: 'a', label: 'A again', path: 'b' },
        { key: 'nested', label: 'N', path: 'a/inner' },
        { key: 'c', label: 'C', path: './c' },
      ],
    };
    await withSidebar({ pages: sloppy }, async () => {
      const svc = service(cwd, [], { warnings });
      await svc.rebuildAll();
      expect(svc.listAccordions().filter((x) => x.rootId === 'pages')).toEqual([
        { rootId: 'pages', key: 'a', label: 'A', path: 'a' },
        { rootId: 'pages', key: 'c', label: 'C', path: 'c' },
      ]);
      // Three skips on `pages` (the `adr` root runs the same reducer and warns on its own).
      expect(warnings.filter((w) => w.startsWith("root 'pages'"))).toHaveLength(3);
    });
  });

  it('recomputes on an added / removed file and on a change of a glob file, and announces `sidebar:accordions-changed { rootId }` only when the array differs — also across a context rebuild', async () => {
    const cwd = tmp();
    const events: WsEvent[] = [];
    const changed = () => events.filter((e) => e.kind === 'sidebar:accordions-changed');
    put(path.join(cwd, 'pages', 'api', 'index.md'), '---\ntitle: API\n---\n');
    put(path.join(cwd, 'pages', 'notes.md'), '# notes\n');
    await withSidebar({ pages: PER_DIR }, async () => {
      const svc = service(cwd, events);
      await svc.rebuildAll();
      expect(changed()).toEqual([]); // first computation: nothing to differ from
      const input = { rootId: 'pages' };

      // A change of a known file outside the glob: no recompute, no event.
      put(path.join(cwd, 'pages', 'notes.md'), '# notes v2\n');
      await svc.onChange(SCOPE, 'pages:pages', 'notes.md', 'external', input);
      expect(changed()).toEqual([]);

      // An added file that adds an accordion.
      put(path.join(cwd, 'pages', 'guides', 'index.md'), '---\ntitle: Guides\n---\n');
      await svc.onChange(SCOPE, 'pages:pages', 'guides/index.md', 'external', input);
      expect(changed()).toEqual([{ kind: 'sidebar:accordions-changed', rootId: 'pages' }]);
      // (`adr`, a `pages` root too, has no `<dir>/index.md` → its array is empty.)
      expect(svc.listAccordions().map((a) => a.key)).toEqual(['api', 'guides']);

      // A frontmatter change of a glob file relabels it.
      put(path.join(cwd, 'pages', 'guides', 'index.md'), '---\ntitle: How-tos\n---\n');
      await svc.onChange(SCOPE, 'pages:pages', 'guides/index.md', 'external', input);
      expect(changed()).toHaveLength(2);
      expect(svc.listAccordions().find((a) => a.key === 'guides')?.label).toBe('How-tos');

      // An added file that does not change the array: recomputed, not announced.
      put(path.join(cwd, 'pages', 'api', 'extra.md'), '# extra\n');
      await svc.onChange(SCOPE, 'pages:pages', 'api/extra.md', 'external', input);
      expect(changed()).toHaveLength(2);

      // A removed file that removes an accordion.
      fs.rmSync(path.join(cwd, 'pages', 'guides'), { recursive: true });
      await svc.onUnlink(SCOPE, 'pages:pages', 'guides/index.md', 'external', input);
      expect(changed()).toHaveLength(3);
      expect(svc.listAccordions().map((a) => a.key)).toEqual(['api']);

      // A context rebuild (a new instance, same project): an unchanged array is
      // not announced, a different one is.
      const rebuilt = service(cwd, events);
      await rebuilt.rebuildAll();
      expect(changed()).toHaveLength(3);
      put(path.join(cwd, 'pages', 'api', 'index.md'), '---\ntitle: HTTP API\n---\n');
      const rebuiltAgain = service(cwd, events);
      await rebuiltAgain.rebuildAll();
      expect(changed()).toHaveLength(4);
      expect(changed()[3]).toEqual({ kind: 'sidebar:accordions-changed', rootId: 'pages' });
    });
  });

  it('reads the glob files\' frontmatter from the frontmatter indexer when the kind selected it, and never reads content into the input', async () => {
    const cwd = tmp();
    put(path.join(cwd, 'pages', 'api', 'index.md'), '---\ntitle: On disk\n---\nbody text\n');
    const seen: Array<{ paths: readonly string[]; fm: Array<[string, Record<string, unknown>]> }> = [];
    const spy: SidebarReducer = {
      glob: '*/index.md',
      reduce: ({ paths, frontmatter }) => {
        seen.push({ paths, fm: [...frontmatter] });
        return [];
      },
    };
    await withSidebar({ pages: spy }, async () => {
      const svc = new SidebarAccordionsService({
        cwd,
        registry: new RootRegistry(USER_ROOTS),
        ws: { broadcast: () => {} },
        projectKey: cwd,
        frontmatterOf: (rootId, rel) => (rootId === 'pages' && rel === 'api/index.md' ? { title: 'Indexed' } : null),
      });
      await svc.rebuildAll();
    });
    // `adr` is a `pages` root too, empty here.
    expect(seen[0]).toEqual({ paths: ['api/index.md'], fm: [['api/index.md', { title: 'Indexed' }]] });
    expect(JSON.stringify(seen)).not.toContain('body text');
  });
});
