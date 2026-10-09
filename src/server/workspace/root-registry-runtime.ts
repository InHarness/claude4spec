import fs from 'node:fs';
import type { Root } from '../../shared/types.js';
import {
  BASE_REACTION_ID,
  SIDEBAR_REDUCER_ID,
  kindDeclaration,
  kindHasFacade,
  kindHasMarkdown,
  sidebarReducerOf,
  type RootKind,
} from '../../shared/root-kinds.js';
import { isMarkdownPath } from '../../shared/page-files.js';
import { PagesService } from '../services/pages.js';
import { MarkdownFileStore } from '../services/markdown-file-store.js';
import { StaticHtmlService } from '../services/static-html.js';
import { FileSerializer } from '../services/file-serializer.js';
import {
  ARTIFACT_KIND_OF_ROOT_KIND,
  type ArtifactKind,
  type ArtifactRootKind,
} from '../services/artifact-registry.js';
import { sourceNameFor, boundWriter, type SelfWriteMarker } from '../fs/sources.js';
import { validateKindRequirements, type ReactionBinder } from '../fs/reactions.js';
import type { ScopedWatchRegistrar } from '../fs/watcher.js';
import { RecordStore, RecordPathError } from '../fs/record-store.js';
import { markdownAdapter, type MarkdownRecord } from '../fs/record-adapters.js';
import { rootDirAbs, type RegistryRoot, type RootRegistry } from '../roots/registry.js';

/**
 * 2.1.8 — the build hook of the L13 implementor (M02), run by M31 while a
 * `ProjectContext` is built: one loop over the ROOT REGISTRY (user roots of kind
 * `pages` from `config.roots[]` + the system roots registered in code).
 *
 * Split in two calls because mount → bind is a contract per source and the
 * reactions' services are built in between:
 *   - `mountRegistryRoots` — per root: the kind's requirements (a violation
 *     stops the build, checked before the root mounts anything), (1) the dir +
 *     its M40 source, (2) the root's file store — a `MarkdownFileStore`
 *     primitive for every kind whose file map has a markdown entry, wrapped by
 *     the `PagesService` facade for every kind whose `sidebar` is not `hidden`
 *     (2.1.9 — a "root with a facade"; before, kind `pages` only);
 *   - `bindRegistryReactions` — per root: the reactions its kind selects, plus
 *     the base `m02-file-changed`, plus `m02-sidebar-reducer` where the kind's
 *     `sidebar` declares a reducer.
 *
 * Every mount and binding lives in the context's watch scope, so the context's
 * dispose (`w.dispose()`) takes the sources and bindings of every registry root
 * down with it; a `roots[]` change invalidates the context and the rebuild runs
 * this hook again (then the boot `indexAll()` passes).
 */

/**
 * A root WITH A FACADE — any kind whose `sidebar` is not `hidden` — the
 * `PagesService` facade over its markdown store. These runtimes are what the page
 * routes and the page write operations resolve `rootId` against.
 */
export interface RootRuntime {
  /** The root's record: the full `config.roots[]` entry for a user root, the registry entry's four fields for a code root. */
  root: Root;
  kind: RootKind;
  pages: PagesService;
  staticHtml: StaticHtmlService;
  source: string;
  writer: SelfWriteMarker;
  serializer: FileSerializer;
}

/** A system root of kind plans/briefs/patches — the bare markdown store, no facade. */
export interface ArtifactMount {
  kind: ArtifactKind;
  rootId: string;
  store: MarkdownFileStore;
  source: string;
  writer: SelfWriteMarker;
  serializer: FileSerializer;
}

export interface MountedRegistry {
  /** One per root with a facade (kind `sidebar` ≠ `hidden`), in registry order. */
  rootRuntimes: RootRuntime[];
  artifactMounts: Map<ArtifactKind, ArtifactMount>;
  /** Every registry root → its mounted M40 source. */
  sourceByRootId: Map<string, string>;
  /** Every root with markdown entries → its `MarkdownFileStore` primitive. */
  storeByRootId: Map<string, MarkdownFileStore>;
  writerByRootId: Map<string, SelfWriteMarker>;
  serializerByRootId: Map<string, FileSerializer>;
}

/**
 * One M42 record store per markdown mount.
 *
 * The store is bound to `(scope, source)` — the scope comes from the registrar
 * the mount owner already holds — so its path mutex and its suppression tokens
 * are per project, and two projects sharing a `relPath` never mask each other.
 *
 * The path rule is the source's, not the primitive's: only `.md` / `.mdx` are
 * records here, and anything else is refused in step 1 as an addressing error
 * rather than serialized and written.
 */
function markdownRecordStore(
  registrar: ScopedWatchRegistrar,
  source: string,
  dir: string,
): RecordStore<MarkdownRecord> {
  return new RecordStore<MarkdownRecord>({
    registrar,
    source,
    dir,
    adapter: markdownAdapter,
    validatePath: (relPath) => {
      if (!isMarkdownPath(relPath)) throw new RecordPathError(`only .md / .mdx paths allowed: ${relPath}`);
    },
  });
}

/**
 * Steps 1–3 of the loop. `userRoots` are the effective `config.roots[]` entries
 * (the facade keeps the full user-root record, extra properties included).
 */
export async function mountRegistryRoots(opts: {
  cwd: string;
  registry: RootRegistry;
  userRoots: readonly Root[];
  w: ScopedWatchRegistrar;
}): Promise<MountedRegistry> {
  const { cwd, registry, userRoots, w } = opts;
  const out: MountedRegistry = {
    rootRuntimes: [],
    artifactMounts: new Map(),
    sourceByRootId: new Map(),
    storeByRootId: new Map(),
    writerByRootId: new Map(),
    serializerByRootId: new Map(),
  };
  for (const root of registry.list()) {
    // The acceptance requirements of the reactions the kind selects come first:
    // a violation throws out of the build before this root mounts anything.
    validateKindRequirements(kindDeclaration(root.kind));
    // 1. observation of the root's dir.
    const source = sourceNameFor(root);
    const abs = rootDirAbs(cwd, root);
    // chokidar silently swallows ENOENT on a missing dir — mkdir before the mount.
    await fs.promises.mkdir(abs, { recursive: true });
    w.mountSource({ source, dir: abs });
    out.sourceByRootId.set(root.id, source);

    // 2. the root's file store: the primitive for every kind with markdown
    //    entries; the facade on top of it for every kind whose `sidebar` is not
    //    `hidden` — gated on the kind's declaration, never on the kind's name.
    if (kindHasMarkdown(root.kind)) {
      const store = new MarkdownFileStore({ cwd, rootId: root.id, dir: root.dir, kind: root.kind });
      store.records = markdownRecordStore(w, source, store.root);
      const writer = boundWriter(w, source);
      const serializer = new FileSerializer(store);
      out.storeByRootId.set(root.id, store);
      out.writerByRootId.set(root.id, writer);
      out.serializerByRootId.set(root.id, serializer);
      if (kindHasFacade(root.kind)) {
        const record = rootRecordOf(root, userRoots);
        out.rootRuntimes.push({
          root: record,
          kind: root.kind,
          pages: new PagesService({ root: record, store }),
          staticHtml: new StaticHtmlService(cwd, root.dir),
          source,
          writer,
          serializer,
        });
      }
      const artifactKind = ARTIFACT_KIND_OF_ROOT_KIND[root.kind as ArtifactRootKind] as ArtifactKind | undefined;
      if (artifactKind) {
        out.artifactMounts.set(artifactKind, { kind: artifactKind, rootId: root.id, store, source, writer, serializer });
      }
    }
  }
  return out;
}

/**
 * The record a facade keeps for its root: the user root's own `config.roots[]`
 * entry (extra properties included) when the root comes from the configuration,
 * otherwise the registry entry's four fields.
 */
function rootRecordOf(root: RegistryRoot, userRoots: readonly Root[]): Root {
  if (kindDeclaration(root.kind).source === 'config') {
    const userRoot = userRoots.find((r) => r.id === root.id);
    if (userRoot) return userRoot;
  }
  return { id: root.id, name: root.name, dir: root.dir, builtin: root.builtin };
}

/**
 * Step 4: bind the reactions each root's KIND selected, plus the base
 * `m02-file-changed` (bound on every root; no kind opts out). Step 5 (2.1.9):
 * where the kind's `sidebar` declares a reducer, bind `m02-sidebar-reducer` on
 * the root's source too — with no glob of its own at M40 (the binding narrows to
 * the kind's file map like every binding); the reducer's glob is applied by the
 * reaction itself. Explicit iteration of the registry — there are no wildcards
 * on `source`. Each binding carries the registry entry's id as the reaction's
 * input. An unknown reaction id or an unmounted source throws (fail-fast).
 */
export function bindRegistryReactions<C>(
  registry: RootRegistry,
  sourceByRootId: ReadonlyMap<string, string>,
  binder: ReactionBinder<C>,
): void {
  for (const root of registry.list()) {
    const source = sourceByRootId.get(root.id);
    if (!source) throw new Error(`[l13] registry root '${root.id}' has no mounted source`);
    const input = { rootId: root.id };
    for (const id of kindDeclaration(root.kind).reactions) binder.bindReaction(id, source, root.kind, input);
    binder.bindReaction(BASE_REACTION_ID, source, root.kind, input);
    if (sidebarReducerOf(root.kind)) binder.bindReaction(SIDEBAR_REDUCER_ID, source, root.kind, input);
  }
}
