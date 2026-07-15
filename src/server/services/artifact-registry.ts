/**
 * M36 — artifactRegistry: single source of truth for chat artifacts stored as
 * markdown-with-frontmatter files outside the Root Registry (briefs, patches,
 * and — in a follow-up brief — plans). Each entry declares how its kind mounts
 * (dirConfigKey/rootId), what frontmatter mutation is allowed, how it binds to
 * chat threads, and cross-cutting policy (dangling/git/anchor/section).
 *
 * `ArtifactKind` only lists `'brief' | 'patch'` for now — plans have no
 * filesystem representation yet (see brief 0-1-126-to-0-1-127, which adds a
 * third `'plan'` entry to this same registry once that migration lands).
 * `artifactRegistry` is declared as a keyed `Record`, not two standalone
 * consts, precisely so that widening `ArtifactKind` later is a one-line type
 * change plus one new map entry — not a restructure of every consumer.
 */

import {
  BRIEF_IMMUTABLE_FRONTMATTER_KEYS,
  PATCH_IMMUTABLE_FRONTMATTER_KEYS,
} from '../../shared/entities.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER } from '../../shared/types.js';

export type ArtifactKind = 'brief' | 'patch';

export interface ArtifactFrontmatterContract {
  /** Keys the artifact's own creator sets; the claude4spec side never mutates them. */
  immutable: readonly string[];
  /** Keys mutable via `PATCH /api/artifacts/:kind/:path/frontmatter`. */
  mutable: readonly string[];
}

export interface ArtifactBinding {
  /** anchor = one required thread pointer set at create-time; attach = N:1, optional, mutable. */
  mode: 'anchor' | 'attach';
  /** ChatContextType this kind's threads carry (chat-context.ts CONTEXT_TYPE_REGISTRY key). */
  contextType?: string;
  /** chat_thread column that stores the reference to this artifact's path. */
  threadColumn: string;
}

export interface ArtifactRegistryEntry {
  kind: ArtifactKind;
  /** BootConfig key holding this artifact's directory. */
  dirConfigKey: 'briefsDir' | 'patchesDir';
  /** file_version rootId marker for this kind (also the PagesService/PagesWatcher rootId). */
  rootId: string;
  /** frontmatter.type value that identifies this kind to PagesFrontmatterIndexer. */
  frontmatterType: string;
  frontmatterContract: ArtifactFrontmatterContract;
  binding: ArtifactBinding;
  danglingPolicy: 'invariant-banner' | 'graceful-degrade';
  gitPolicy: 'committed-by-default';
  anchorInjection: boolean;
  sectionIndexed: false;
  /** WS event kind broadcast on a change to this artifact's mount (see PagesFrontmatterIndexer.broadcastRootChange). */
  changedEvent: 'briefs:changed' | 'patches:changed';
}

export const artifactRegistry: Record<ArtifactKind, ArtifactRegistryEntry> = {
  brief: {
    kind: 'brief',
    dirConfigKey: 'briefsDir',
    rootId: BRIEF_ROOT_MARKER,
    frontmatterType: 'brief',
    frontmatterContract: {
      immutable: BRIEF_IMMUTABLE_FRONTMATTER_KEYS,
      mutable: ['implemented'],
    },
    binding: { mode: 'anchor', contextType: 'brief', threadColumn: 'brief_path' },
    danglingPolicy: 'invariant-banner',
    gitPolicy: 'committed-by-default',
    anchorInjection: false,
    sectionIndexed: false,
    changedEvent: 'briefs:changed',
  },
  patch: {
    kind: 'patch',
    dirConfigKey: 'patchesDir',
    rootId: PATCH_ROOT_MARKER,
    frontmatterType: 'patch',
    frontmatterContract: {
      immutable: PATCH_IMMUTABLE_FRONTMATTER_KEYS,
      mutable: ['status'],
    },
    binding: { mode: 'anchor', contextType: 'patch', threadColumn: 'patch_path' },
    danglingPolicy: 'invariant-banner',
    gitPolicy: 'committed-by-default',
    anchorInjection: false,
    sectionIndexed: false,
    changedEvent: 'patches:changed',
  },
};
