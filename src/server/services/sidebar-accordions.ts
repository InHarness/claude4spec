import fs from 'node:fs';
import path from 'node:path';
import type { SidebarAccordion } from '../../shared/types.js';
import { hasDotSegment } from '../../shared/page-files.js';
import {
  KIND_DECLARATIONS,
  PAGES_KIND,
  accordionCase,
  enforceAccordionRules,
  fileMapEntryOf,
  globToRegExp,
  kindSelects,
  sidebarReducerOf,
  type RegistryRoot,
  type RootKind,
  type SidebarAccordionItem,
} from '../../shared/root-kinds.js';
import type { ReactionHandler, ReactionInput } from '../fs/reactions.js';
import type { WatchOrigin, WatchScope } from '../fs/watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { rootDirAbs, type RootRegistry } from '../roots/registry.js';
import { parseFrontmatterFields } from './pages.js';

/**
 * 2.1.9 — M02 as the L13 implementor: the sidebar's accordion arrays
 * (`m02l13001` „Reduktory sidebar”, reaction `m02-sidebar-reducer` in
 * `x6avfb5q`).
 *
 * Every registry root enters the sidebar through the accordion array of its
 * kind's `sidebar` field:
 *  - `hidden` / `accordion` are computed straight from the declaration, no
 *    reaction bound (`[]`, or one `{ key: id, label: name, path: '' }`);
 *  - a REDUCER is called by this object, bound as `m02-sidebar-reducer` on the
 *    root's source. Its input is the root's file paths plus the frontmatter of
 *    the files matching the reducer's glob — from the frontmatter indexer when
 *    the kind selected it, read from the root's files otherwise. The result is
 *    cached per `rootId`; the L13 result rules are enforced here (a breaking
 *    element is skipped with a warning, the later of two overlapping subtrees is
 *    skipped). A reducer that throws gives the `accordion` fallback, and so does
 *    a reducer root not yet computed. Nothing ever refuses a read: the array is
 *    a navigation view, not coordinates anyone writes from.
 *
 * Recompute triggers: a file added or removed (the handler compares the path
 * with the root's path set) and a change of a file matching the glob. When a
 * root's array differs from its previous one — across a context rebuild too —
 * `sidebar:accordions-changed { rootId }` goes to the project's room.
 */

/**
 * The previous array per `(project, rootId)`, kept across context instances so
 * a rebuilt context can tell whether the array it computed differs from what
 * its predecessor served ("także po przebudowie kontekstu").
 */
const LAST_ARRAY = new Map<string, string>();

export interface SidebarAccordionsOptions {
  cwd: string;
  registry: RootRegistry;
  ws: WsEmitter;
  /** Key of the project — scopes the cross-rebuild memory of previous arrays. */
  projectKey: string;
  /** The frontmatter indexer's record, used for roots whose kind selected `m02-frontmatter-indexer`. */
  frontmatterOf?: (rootId: string, relPath: string) => Record<string, unknown> | null;
  /** Warnings of the result rules / failing reducers (default `console.warn`). */
  warn?: (message: string) => void;
}

export class SidebarAccordionsService implements ReactionHandler {
  private readonly cache = new Map<string, SidebarAccordionItem[]>();
  private readonly pathSets = new Map<string, Set<string>>();
  private readonly warn: (message: string) => void;

  constructor(private readonly opts: SidebarAccordionsOptions) {
    this.warn = opts.warn ?? ((m) => console.warn(`[m02] ${m}`));
  }

  /** Roots whose kind declares a reducer — the ones this object computes and caches. */
  reducerRoots(): RegistryRoot[] {
    return this.opts.registry.list().filter((r) => sidebarReducerOf(r.kind) !== undefined);
  }

  /**
   * Root Registry API `listAccordions()` — the ordered accordion array of every
   * root: the `pages` roots in registry order first, then the roots of the
   * other kinds in the kinds' registration order (registry order within one
   * kind); within a root, the order of its array. A `hidden` root adds nothing.
   */
  listAccordions(): SidebarAccordion[] {
    const kindOrder = Object.keys(KIND_DECLARATIONS) as RootKind[];
    const rank = (r: RegistryRoot): number => (r.kind === PAGES_KIND ? -1 : kindOrder.indexOf(r.kind));
    const roots = this.opts.registry
      .list()
      .map((root, index) => ({ root, index }))
      .sort((a, b) => rank(a.root) - rank(b.root) || a.index - b.index)
      .map((e) => e.root);
    const out: SidebarAccordion[] = [];
    for (const root of roots) {
      for (const item of this.arrayOf(root)) out.push({ rootId: root.id, ...item });
    }
    return out;
  }

  /** One root's array: from the declaration, or the reducer's cached result (fallback `accordion`). */
  arrayOf(root: RegistryRoot): SidebarAccordionItem[] {
    const sidebar = KIND_DECLARATIONS[root.kind].sidebar;
    if (typeof sidebar !== 'object') return accordionCase(root, sidebar);
    return this.cache.get(root.id) ?? accordionCase(root, 'accordion');
  }

  /**
   * Computes every reducer root not computed yet (2.1.9, M52). The route awaits
   * it before reading, so a request racing the context build's fire-and-forget
   * `rebuildAll()` is served the reducer's result rather than the `accordion`
   * fallback — the fallback stays the answer of a reducer that throws.
   */
  async settle(): Promise<void> {
    for (const root of this.reducerRoots()) if (!this.cache.has(root.id)) await this.recompute(root.id);
  }

  /**
   * Full rebuild at context build: computes every reducer root. Never blocks the
   * project — a root still being computed is served the `accordion` fallback.
   */
  async rebuildAll(): Promise<void> {
    for (const root of this.reducerRoots()) await this.recompute(root.id);
  }

  /**
   * Recomputes one reducer root and announces a difference from its previous
   * array. Returns whether the array changed. A non-reducer root is a no-op.
   */
  async recompute(rootId: string): Promise<boolean> {
    const root = this.opts.registry.get(rootId);
    const reducer = root ? sidebarReducerOf(root.kind) : undefined;
    if (!root || !reducer) return false;
    const paths = await this.listRootPaths(root);
    this.pathSets.set(rootId, new Set(paths));
    let next: SidebarAccordionItem[];
    try {
      const glob = globToRegExp(reducer.glob);
      const frontmatter = new Map<string, Record<string, unknown>>();
      for (const rel of paths) {
        if (!glob.test(rel) || fileMapEntryOf(root.kind, rel)?.format !== 'markdown') continue;
        frontmatter.set(rel, await this.frontmatterFor(root, rel));
      }
      const result = reducer.reduce({ paths, frontmatter });
      if (!Array.isArray(result)) throw new Error('the reducer returned no array');
      next = enforceAccordionRules(result, (m) => this.warn(`root '${rootId}': ${m}`));
    } catch (err) {
      this.warn(`root '${rootId}': sidebar reducer failed (${(err as Error).message}) — accordion fallback`);
      next = accordionCase(root, 'accordion');
    }
    this.cache.set(rootId, next);
    const key = `${this.opts.projectKey}\u0000${rootId}`;
    const serialized = JSON.stringify(next);
    const previous = LAST_ARRAY.get(key);
    LAST_ARRAY.set(key, serialized);
    if (previous === undefined || previous === serialized) return false;
    this.opts.ws.broadcast({ kind: 'sidebar:accordions-changed', rootId });
    return true;
  }

  // ── the `m02-sidebar-reducer` reaction ─────────────────────────────────────

  async onChange(
    _scope: WatchScope,
    _source: string,
    relPath: string,
    _origin: WatchOrigin,
    input: ReactionInput,
  ): Promise<void> {
    const root = this.opts.registry.get(input.rootId);
    const reducer = root ? sidebarReducerOf(root.kind) : undefined;
    if (!root || !reducer) return;
    const rel = relPath.replace(/\\/g, '/');
    const known = this.pathSets.get(root.id);
    const added = !known || !known.has(rel);
    if (added || globToRegExp(reducer.glob).test(rel)) await this.recompute(root.id);
  }

  async onUnlink(
    _scope: WatchScope,
    _source: string,
    relPath: string,
    _origin: WatchOrigin,
    input: ReactionInput,
  ): Promise<void> {
    const root = this.opts.registry.get(input.rootId);
    if (!root || !sidebarReducerOf(root.kind)) return;
    const known = this.pathSets.get(root.id);
    if (!known || known.has(relPath.replace(/\\/g, '/'))) await this.recompute(root.id);
  }

  // ── input ──────────────────────────────────────────────────────────────────

  /** Every file of the root that is an entry of its kind's file map (dot-subtrees excluded), sorted. */
  private async listRootPaths(root: RegistryRoot): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (hasDotSegment(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
        else if (entry.isFile() && fileMapEntryOf(root.kind, rel)) out.push(rel);
      }
    };
    await walk(rootDirAbs(this.opts.cwd, root), '');
    return out.sort();
  }

  private async frontmatterFor(root: RegistryRoot, rel: string): Promise<Record<string, unknown>> {
    if (this.opts.frontmatterOf && kindSelects(root.kind, 'm02-frontmatter-indexer')) {
      const indexed = this.opts.frontmatterOf(root.id, rel);
      if (indexed) return indexed;
    }
    try {
      const raw = await fs.promises.readFile(path.join(rootDirAbs(this.opts.cwd, root), rel), 'utf8');
      const block = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw)?.[0];
      return (block ? parseFrontmatterFields(block) : undefined) ?? {};
    } catch {
      return {};
    }
  }
}
