import { isSystemRootId, kindDeclaration, systemRootId, type RegistryRoot } from '../../shared/root-kinds.js';
import type { ReactionInput } from './reactions.js';

/**
 * Source-name conventions (M40, 0.2.10).
 *
 * `source` is OPAQUE to M40 — it is just a string unique within a scope. The
 * discriminator lives in the name because `rootId` is not an M40 concept: the
 * mounting party (2.1.8: the root-registry implementor for every registry root,
 * M33 for `plugins:*`) encodes it in the suffix. Reactions bound on a registry
 * root take `rootId` from their input (the binding passes the registry entry's
 * id, {@link reactionRootId}) — the base `m02-file-changed` notification and
 * `m02-frontmatter-indexer` included; the suffix serves readers outside a
 * binding (the projection staleness scope) and direct calls.
 */

/** One source per `pages` root, mounted by the root-registry implementor (L13) from the registry. Builtin root is `pages:pages`. */
export function pageSource(rootId: string): string {
  return `pages:${rootId}`;
}

/** One source per artifact system root, over `.claude4spec/briefs` / `patches` / `plans`. */
export function artifactSource(kind: 'brief' | 'patch' | 'plan'): string {
  return `artifacts:${kind}`;
}

/** M29 — entity files (`.claude4spec/entities/`). */
export const ENTITIES_SOURCE = 'entities';
/** M29 — release identity files (`.claude4spec/releases/`). */
export const RELEASES_SOURCE = 'releases';
/** M33 — the shared base plugin pool. The only `scope: 'process'` mount. */
export const PLUGINS_BASE_SOURCE = 'plugins:base';
/** M33 — `<cwd>/.claude4spec/plugins/`, mounted only behind `trustProjectPlugins`. */
export const PLUGINS_OVERLAY_SOURCE = 'plugins:overlay';

/**
 * 2.1.8 — the source name of a registry root. The implementor of the root
 * registry (M02) mounts exactly one source per root under this name. 2.1.9
 * (`m02l13001` step 1): `pages:<id>` for a root from the configuration source,
 * the kind's name for a root from the `code` source (`entities`, `releases`, …),
 * except `plans` / `briefs` / `patches`, which keep the established
 * `artifacts:plan|brief|patch`.
 */
export function sourceNameFor(root: Pick<RegistryRoot, 'id' | 'kind'>): string {
  if (kindDeclaration(root.kind).source === 'config') return pageSource(root.id);
  switch (root.kind) {
    case 'plans':
      return artifactSource('plan');
    case 'briefs':
      return artifactSource('brief');
    case 'patches':
      return artifactSource('patch');
    default:
      return root.kind;
  }
}

/** `artifacts:<kind>` → the id of the system root of that root kind, looked up BY KIND. */
const ARTIFACT_ROOT_ID: Record<string, string> = {
  brief: systemRootId('briefs'),
  patch: systemRootId('patches'),
  plan: systemRootId('plans'),
};

/**
 * Derive the `rootId` of the registry root a source was mounted for. For
 * `pages:<rootId>` that is the root's own id; for `artifacts:<kind>` it is the
 * system root's id (`'briefs'` / `'patches'` / `'plans'`, 2.1.8 — the value
 * `file_version.rootId` carries); `entities` and `releases` are their own ids.
 *
 * Returns null for sources outside the registry (`plugins:*`), so a caller that
 * needs one fails loudly rather than inventing it.
 */
export function rootIdFromSource(source: string): string | null {
  if (source.startsWith('pages:')) return source.slice('pages:'.length) || null;
  if (source.startsWith('artifacts:')) return ARTIFACT_ROOT_ID[source.slice('artifacts:'.length)] ?? null;
  // A code-source root's source is its kind's name, and its id is that kind.
  if (isSystemRootId(source)) return source;
  return null;
}

/**
 * 2.1.8 — the `rootId` a reaction keys its state on: the registry entry's id the
 * root-registry implementor passed at binding ({@link ReactionInput}). Only a
 * handler invoked outside a binding (a direct call) falls back to the source name.
 */
export function reactionRootId(source: string, input?: ReactionInput): string {
  return input?.rootId ?? requireRootId(source);
}

/** `rootIdFromSource` for callers that cannot proceed without one. */
export function requireRootId(source: string): string {
  const rootId = rootIdFromSource(source);
  if (!rootId) throw new Error(`[m40] source '${source}' carries no rootId`);
  return rootId;
}

/**
 * A source-bound `suppress` handle, for a write primitive that owns exactly one
 * source and should not have to know its name. Hand-built by the mount owner:
 * `boundSuppress(w, ENTITIES_SOURCE)`.
 */
export interface SelfWriteSuppressor {
  suppress(relPath: string): void;
}

export function boundSuppress(
  registrar: { suppress(source: string, relPath: string): void },
  source: string,
): SelfWriteSuppressor {
  return { suppress: (relPath) => registrar.suppress(source, relPath) };
}

/**
 * The handle an ordinary server write needs, bound to one source.
 *
 * 0.2.76 — this handle is now the FALLBACK path, for a caller with no M42 record
 * store: the hand-rolled rigs, and a bundle carrying a root this project has not
 * configured. Every mounted source writes through the primitive instead, which
 * suppresses its own event and runs the chain in-band.
 *
 * On that fallback path `markOrigin` labels the write — it does NOT suppress, so
 * every phase still runs and the event carries `origin: 'server'`. `flush` then
 * drives that reaction chain to completion, which is what makes the write
 * read-after-write consistent: `capture` (M17) is the sole author of
 * `file_version`, so the version must exist before the caller responds.
 */
export interface SelfWriteMarker {
  markOrigin(relPath: string, actor: WriteActor): void;
  /** Run the reaction chain for this path now, and swallow the fs echo. */
  flush(relPath: string, event?: 'add' | 'change' | 'unlink'): Promise<void>;
  suppress(relPath: string): void;
  /**
   * Give back a token whose write FAILED — a suppress is issued before the write,
   * so a throw in between leaves it to swallow the next genuine event instead.
   * Optional: the many hand-built `{ suppress: () => {} }` fakes are still valid
   * handles, and a caller that never fails never needs it.
   */
  unsuppress?(relPath: string): void;
}

export type WriteActor = 'user' | 'agent';

export function boundWriter(
  registrar: {
    markOrigin(source: string, relPath: string, actor: WriteActor): void;
    suppress(source: string, relPath: string): void;
    unsuppress(source: string, relPath: string): void;
    flush(source: string, relPath: string, event?: 'add' | 'change' | 'unlink'): Promise<void>;
  },
  source: string,
): SelfWriteMarker {
  return {
    markOrigin: (relPath, actor) => registrar.markOrigin(source, relPath, actor),
    suppress: (relPath) => registrar.suppress(source, relPath),
    unsuppress: (relPath) => registrar.unsuppress(source, relPath),
    flush: (relPath, event) => registrar.flush(source, relPath, event),
  };
}

/** A no-op handle, for the single-root callers that may legitimately have none. */
export const NULL_WRITER: SelfWriteMarker = {
  markOrigin: () => {},
  flush: async () => {},
  suppress: () => {},
  unsuppress: () => {},
};

// 2.1.8: the mechanical filters are derived from each kind's file map
// (`fileMapFilter` in `src/shared/root-kinds.ts`), per reaction binding.
