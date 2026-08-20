/**
 * M36 — artifactRegistry: single source of truth for chat artifacts stored as
 * markdown-with-frontmatter files outside the Root Registry (briefs, patches,
 * and — as of 0.1.127 — plans). Each entry declares how its kind mounts
 * (dirConfigKey/rootId), what frontmatter mutation is allowed, how it binds to
 * chat threads, and cross-cutting policy (dangling/git/anchor/section).
 *
 * `artifactRegistry` is declared as a keyed `Record`, not standalone consts
 * per kind, precisely so that widening `ArtifactKind` is a one-line type
 * change plus one new map entry — not a restructure of every consumer.
 */

import {
  BRIEF_IMMUTABLE_FRONTMATTER_KEYS,
  PATCH_IMMUTABLE_FRONTMATTER_KEYS,
  PLAN_IMMUTABLE_FRONTMATTER_KEYS,
} from '../../shared/entities.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER, PLAN_ROOT_MARKER } from '../../shared/types.js';

export type ArtifactKind = 'brief' | 'patch' | 'plan';

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

/**
 * 0.2.40 — the four positions of the artifact READ family.
 *
 * The rule is not "every kind must have all four". It is that every kind must
 * DECLARE A VALUE for all four — and `'n/a — <reason>'` is a legal, sufficient
 * value. An asymmetry between kinds is a specification error when, and only
 * when, it is unwritten: a missing `search_briefs` that nobody recorded is
 * indistinguishable from one nobody noticed. Written down, it is a known gap
 * with a reason attached, which is a thing a plan can pick up.
 *
 * These strings are documentation with a test behind it (see the architecture
 * suite), not dispatch data. Nothing branches on them.
 */
export interface ArtifactReadFamily {
  /** Paginated listing, filtered by the execution flag in `frontmatterContract`. */
  list: string;
  /** Content + frontmatter + hash, plus a `range` line window with NO `sectionIndexed` gate. */
  getWithWindow: string;
  /** Content search; a hit's identity is `(rootId, path, line)`, with no anchor. */
  search: string;
  /** `truncated` per item, `truncationHint` per envelope. */
  responseBudget: string;
}

export interface ArtifactRegistryEntry {
  kind: ArtifactKind;
  /** BootConfig key holding this artifact's directory. */
  dirConfigKey: 'briefsDir' | 'patchesDir' | 'plansDir';
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
  changedEvent: 'briefs:changed' | 'patches:changed' | 'plans:changed';
  /** 0.2.40 — the four positions of the read family. Every kind declares all four. */
  readFamily: ArtifactReadFamily;
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
    readFamily: {
      list: 'c4s list-briefs (cli) + GET /api/artifacts/brief (rest), filtered by frontmatter.implemented',
      getWithWindow: 'get_brief({ path?, range? }) — line window, no sectionIndexed gate',
      search:
        'n/a — no search operation exists for briefs in any channel; a named GAP, not a decision. ' +
        'search_briefs and list_briefs coverage on the agent channels (internal/mcp) are an open <todo> for a separate plan.',
      responseBudget: 'truncated: true per item + truncationHint pointing unconditionally at range',
    },
  },
  patch: {
    kind: 'patch',
    dirConfigKey: 'patchesDir',
    rootId: PATCH_ROOT_MARKER,
    frontmatterType: 'patch',
    frontmatterContract: {
      immutable: PATCH_IMMUTABLE_FRONTMATTER_KEYS,
      // 0.2.14: `status` (awaiting|completed) -> `applied` (boolean), the same
      // flag and semantics the plan carries.
      mutable: ['applied'],
    },
    binding: { mode: 'anchor', contextType: 'patch', threadColumn: 'patch_path' },
    danglingPolicy: 'invariant-banner',
    gitPolicy: 'committed-by-default',
    anchorInjection: false,
    sectionIndexed: false,
    changedEvent: 'patches:changed',
    readFamily: {
      list: 'GET /api/artifacts/patch (rest), filtered by frontmatter.applied',
      getWithWindow: 'GET /api/artifacts/patch/<path> (rest) — the same range window; no MCP read tool (file_patch is write-only)',
      search: 'n/a — no search operation exists for patches in any channel; same gap as brief.',
      responseBudget: 'truncated: true per item + truncationHint pointing unconditionally at range',
    },
  },
  // 0.1.127 (brief 0-1-126-to-0-1-127): plan diverges from brief/patch on two
  // axes — binding is `attach` (N threads -> 1 plan file, optional, no fixed
  // contextType: any thread kind can carry a plan_mode session) instead of
  // `anchor`, and danglingPolicy is `graceful-degrade` (deleting the file
  // leaves `chat_thread.plan_path` pointing nowhere; the UI shows a banner
  // instead of the invariant briefs/patches enforce). `anchorInjection: true`
  // is the one thing plan shares uniquely with nothing else in this registry —
  // `<!-- anchor --> ` markers are injected into plan headings for
  // insert_after_section targeting and annotations, without full section
  // indexing (`sectionIndexed: false`, same as brief/patch).
  plan: {
    kind: 'plan',
    dirConfigKey: 'plansDir',
    rootId: PLAN_ROOT_MARKER,
    frontmatterType: 'plan',
    frontmatterContract: {
      immutable: PLAN_IMMUTABLE_FRONTMATTER_KEYS,
      mutable: ['title', 'applied'],
    },
    binding: { mode: 'attach', threadColumn: 'plan_path' },
    danglingPolicy: 'graceful-degrade',
    gitPolicy: 'committed-by-default',
    anchorInjection: true,
    sectionIndexed: false,
    changedEvent: 'plans:changed',
    readFamily: {
      list: 'list_plans (mcp) + GET /api/artifacts/plan (rest), filtered by frontmatter.applied',
      getWithWindow: 'get_plan({ range? }) (mcp) + GET /api/artifacts/plan/<path> (rest) — the same range window',
      search: 'n/a — no search operation exists for plans in any channel; same gap as brief.',
      responseBudget: 'truncated: true per item + truncationHint pointing unconditionally at range',
    },
  },
};
