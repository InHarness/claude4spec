import fs from 'node:fs';
import type { Root } from '../../shared/types.js';
import { BASE_REACTION_ID, PAGES_KIND, kindDeclaration, kindHasMarkdown } from '../../shared/root-kinds.js';
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
import { rootDirAbs, type RootRegistry } from '../roots/registry.js';

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
 *     the `PagesService` facade only for kind `pages`;
 *   - `bindRegistryReactions` — per root: the reactions its kind selects, plus
 *     the base `m02-file-changed`.
 *
 * Every mount and binding lives in the context's watch scope, so the context's
 * dispose (`w.dispose()`) takes the sources and bindings of every registry root
 * down with it; a `roots[]` change invalidates the context and the rebuild runs
 * this hook again (then the boot `indexAll()` passes).
 */

/** A root of kind `pages` — the `PagesService` facade over its markdown store. */
export interface RootRuntime {
  root: Root;
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
  /** One per root of kind `pages`, in registry order. */
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
    //    entries; the facade on top of it for kind `pages` only.
    if (kindHasMarkdown(root.kind)) {
      const store = new MarkdownFileStore({ cwd, rootId: root.id, dir: root.dir, kind: root.kind });
      store.records = markdownRecordStore(w, source, store.root);
      const writer = boundWriter(w, source);
      const serializer = new FileSerializer(store);
      out.storeByRootId.set(root.id, store);
      out.writerByRootId.set(root.id, writer);
      out.serializerByRootId.set(root.id, serializer);
      if (root.kind === PAGES_KIND) {
        const userRoot = userRoots.find((r) => r.id === root.id)!;
        out.rootRuntimes.push({
          root: userRoot,
          pages: new PagesService({ root: userRoot, store }),
          staticHtml: new StaticHtmlService(cwd, root.dir),
          source,
          writer,
          serializer,
        });
      } else {
        const artifactKind = ARTIFACT_KIND_OF_ROOT_KIND[root.kind as ArtifactRootKind];
        out.artifactMounts.set(artifactKind, { kind: artifactKind, rootId: root.id, store, source, writer, serializer });
      }
    }
  }
  return out;
}

/**
 * Step 4: bind the reactions each root's KIND selected, plus the base
 * `m02-file-changed` (bound on every root; no kind opts out). Explicit
 * iteration of the registry — there are no wildcards on `source`. Each binding
 * carries the registry entry's id as the reaction's input. An unknown reaction
 * id or an unmounted source throws (fail-fast).
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
  }
}
