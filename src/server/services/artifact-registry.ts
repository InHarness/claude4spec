/**
 * M36 — artifactRegistry: chat artifacts (briefs, patches, plans).
 *
 * 2.1.8: briefs, patches and plans are SYSTEM ROOTS of the root registry. Their
 * directory, frontmatter type and field contract, git policy and anchor
 * injection moved to the kind declaration (`src/shared/root-kinds.ts`). What is
 * left here is keyed by root kind and carries only the link to a chat thread:
 * `binding` and `danglingPolicy`. M36 mounts no source and defines no reaction.
 *
 * `ArtifactKind` (`brief` | `patch` | `plan`) stays the vocabulary of the REST
 * family (`/api/artifacts/:kind`) and of chat contexts; {@link ARTIFACT_ROOT_KIND}
 * maps it onto the root kind.
 */

import { headerContractOf, type HeaderContract } from '../../shared/root-kinds.js';

export type ArtifactKind = 'brief' | 'patch' | 'plan';
export type ArtifactRootKind = 'briefs' | 'patches' | 'plans';

export const ARTIFACT_ROOT_KIND: Readonly<Record<ArtifactKind, ArtifactRootKind>> = {
  brief: 'briefs',
  patch: 'patches',
  plan: 'plans',
};

export const ARTIFACT_KIND_OF_ROOT_KIND: Readonly<Record<ArtifactRootKind, ArtifactKind>> = {
  briefs: 'brief',
  patches: 'patch',
  plans: 'plan',
};

/**
 * The domain event the frontmatter projection broadcasts when an artifact's
 * frontmatter changes (the list views refetch on it). The file-level event is
 * the base `file:changed` every registry root emits.
 */
export const ARTIFACT_CHANGED_EVENT: Readonly<
  Record<ArtifactKind, 'briefs:changed' | 'patches:changed' | 'plans:changed'>
> = {
  brief: 'briefs:changed',
  patch: 'patches:changed',
  plan: 'plans:changed',
};

/** The id of the system root an artifact kind lives in (= its root kind). */
export function artifactRootId(kind: ArtifactKind): ArtifactRootKind {
  return ARTIFACT_ROOT_KIND[kind];
}

/** The header contract of an artifact kind — read from its root kind's file map. */
export function artifactHeaderContract(kind: ArtifactKind): HeaderContract {
  const contract = headerContractOf(ARTIFACT_ROOT_KIND[kind]);
  if (!contract) throw new Error(`root kind '${ARTIFACT_ROOT_KIND[kind]}' declares no header contract`);
  return contract;
}

export type ArtifactFrontmatterContract = Pick<HeaderContract, 'immutable' | 'mutable'>;

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
  /** Paginated listing, filtered by the execution flag of the root kind's header contract. */
  list: string;
  /** Content + frontmatter + hash, plus a `range` line window that is always allowed. */
  getWithWindow: string;
  /** Content search; a hit's identity is `(rootId, path, line)`, with no anchor. */
  search: string;
  /** `truncated` per item, `truncationHint` per envelope. */
  responseBudget: string;
}

export interface ArtifactRegistryEntry {
  binding: ArtifactBinding;
  danglingPolicy: 'invariant-banner' | 'graceful-degrade';
}

export const artifactRegistry: Readonly<Record<ArtifactRootKind, ArtifactRegistryEntry>> = {
  briefs: {
    binding: { mode: 'anchor', contextType: 'brief', threadColumn: 'brief_path' },
    danglingPolicy: 'invariant-banner',
  },
  patches: {
    binding: { mode: 'anchor', contextType: 'patch', threadColumn: 'patch_path' },
    danglingPolicy: 'invariant-banner',
  },
  // 0.1.127: plan binds `attach` (N threads → 1 plan file, optional, any context
  // carrying a plan_mode session) and degrades gracefully when its file is gone.
  plans: {
    binding: { mode: 'attach', threadColumn: 'plan_path' },
    danglingPolicy: 'graceful-degrade',
  },
};

/** The registry entry of an artifact kind (`brief` → `briefs`). */
export function artifactEntry(kind: ArtifactKind): ArtifactRegistryEntry {
  return artifactRegistry[ARTIFACT_ROOT_KIND[kind]];
}

/**
 * 0.2.40 — the four positions of the artifact read family, per kind. Documentation
 * with a test behind it; nothing branches on these strings.
 */
export const ARTIFACT_READ_FAMILY: Readonly<Record<ArtifactKind, ArtifactReadFamily>> = {
  brief: {
    list: 'c4s list-briefs (cli) + GET /api/artifacts/brief (rest), filtered by frontmatter.implemented',
    getWithWindow: 'get_brief({ path?, range? }) — line window, always allowed (an artifact has no section index)',
    search:
      'n/a — no search operation exists for briefs in any channel; a named GAP, not a decision. ' +
      'search_briefs and list_briefs coverage on the agent channels (internal/mcp) are an open <todo> for a separate plan.',
    responseBudget: 'truncated: true per item + truncationHint pointing unconditionally at range',
  },
  patch: {
    list: 'GET /api/artifacts/patch (rest), filtered by frontmatter.applied',
    getWithWindow:
      "GET /api/artifacts/patch/<path> (rest) and get_patch (patch-tools, patch threads only, path defaults to the thread's patch) — the same range window",
    search: 'n/a — no search operation exists for patches in any channel; same gap as brief.',
    responseBudget: 'truncated: true per item + truncationHint pointing unconditionally at range',
  },
  plan: {
    list: 'list_plans (mcp) + GET /api/artifacts/plan (rest), filtered by frontmatter.applied',
    getWithWindow: 'get_plan({ range? }) (mcp) + GET /api/artifacts/plan/<path> (rest) — the same range window',
    search: 'n/a — no search operation exists for plans in any channel; same gap as brief.',
    responseBudget: 'truncated: true per item + truncationHint pointing unconditionally at range',
  },
};
