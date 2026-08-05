import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER, PLAN_ROOT_MARKER } from '../../shared/types.js';

/**
 * Source-name conventions (M40, 0.2.10).
 *
 * `source` is OPAQUE to M40 — it is just a string unique within a scope. The
 * discriminator lives in the name because `rootId` is not an M40 concept: the
 * mount owner encodes it in the suffix, and subscribers derive their own
 * projection keys `(rootId, relPath)` and WS payloads back out of it.
 */

/** M02 — one source per page root, mounted in the `roots[]` loop. Builtin root is `pages:pages`. */
export function pageSource(rootId: string): string {
  return `pages:${rootId}`;
}

/** M36 — one source per artifact registry entry, over `briefsDir` / `patchesDir` / `plansDir`. */
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

const ARTIFACT_ROOT_ID: Record<string, string> = {
  brief: BRIEF_ROOT_MARKER,
  patch: PATCH_ROOT_MARKER,
  plan: PLAN_ROOT_MARKER,
};

/**
 * Derive the `rootId` a subscriber should key its projection by, from the source
 * suffix. For `pages:<rootId>` that is the root's own id; for `artifacts:<kind>`
 * it is the marker literal (`'brief'` / `'patch'` / `'plan'`) — a writing
 * convention shared by M17 and M36 for the `rootId` column, not a contract of the
 * mechanism.
 *
 * Returns null for sources that carry no rootId at all (`entities`, `releases`,
 * `plugins:*`), so a caller that needs one fails loudly rather than inventing it.
 */
export function rootIdFromSource(source: string): string | null {
  if (source.startsWith('pages:')) return source.slice('pages:'.length) || null;
  if (source.startsWith('artifacts:')) return ARTIFACT_ROOT_ID[source.slice('artifacts:'.length)] ?? null;
  return null;
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
 * `markOrigin` labels the write — it does NOT suppress, so every phase still
 * runs and the event carries `origin: 'server'`. `flush` then drives that
 * reaction chain to completion, which is what makes the write read-after-write
 * consistent: `capture` (M17) is the sole author of `file_version`, so the
 * version must exist before the caller responds.
 */
export interface SelfWriteMarker {
  markOrigin(relPath: string, actor: WriteActor): void;
  /** Run the reaction chain for this path now, and swallow the fs echo. */
  flush(relPath: string): Promise<void>;
  suppress(relPath: string): void;
}

export type WriteActor = 'user' | 'agent';

export function boundWriter(
  registrar: {
    markOrigin(source: string, relPath: string, actor: WriteActor): void;
    suppress(source: string, relPath: string): void;
    flush(source: string, relPath: string): Promise<void>;
  },
  source: string,
): SelfWriteMarker {
  return {
    markOrigin: (relPath, actor) => registrar.markOrigin(source, relPath, actor),
    suppress: (relPath) => registrar.suppress(source, relPath),
    flush: (relPath) => registrar.flush(source, relPath),
  };
}

/** A no-op handle, for the single-root callers that may legitimately have none. */
export const NULL_WRITER: SelfWriteMarker = {
  markOrigin: () => {},
  flush: async () => {},
  suppress: () => {},
};

/** Mechanical filters. Markdown drives indexing; `.html` is preview-only (M30). */
export const MARKDOWN_FILTER = '**/*.{md,mdx}';
export const HTML_FILTER = '**/*.html';
export const JSON_FILTER = '**/*.json';
