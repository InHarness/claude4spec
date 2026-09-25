/**
 * MCP server `release-tools` — exposes M17 release operations to agents
 * (chat, external MCP clients). Mirrors `m17mcpprj`: 5 tools — create, list,
 * show, diff, update. `release_restore` is intentionally absent (decyzja 9 +
 * `m17open01` open #3 — restore is human-initiated only).
 *
 * `release_diff` / `release_show` project the raw L2 shape (`RawDelta` /
 * `SpecSnapshot`) onto a self-contained MCP shape (`MCPReleaseDiff` /
 * `MCPSpecSnapshot`). This is the only consumer of `release-tools` in brief
 * threads; the projection is what makes briefs interpretable after HEAD
 * advances beyond the release pair. REST (`/api/releases/...`) and UI keep
 * consuming the raw L2 shape for render-time `line_diff`.
 *
 * 0.2.62: `release_diff` grew a second engine — `toIdOrName: "current"` diffs a
 * release against the live, unreleased state. It costs this server the property
 * that made its toolset safe to hand a subagent without thinking: "release-tools
 * are historical by definition" is no longer true of the WHOLE server, one branch
 * of one tool answers with the present. Nothing here changes to compensate; what
 * changes is that `diff-explore`'s "historical diff only" guarantee now rests on
 * its PROMPT, exactly as its `Read` guarantee always did, rather than on the
 * shape of the tools it holds.
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../../plugin-runtime/index.js';
import { z } from 'zod';
import { splitPageKey, type ReleaseService } from '../../services/release.js';
import type { GitService } from '../../services/git.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
import { CURRENT_RELEASE_NAME, MAX_RELEASE_DESCRIPTION_LENGTH } from '../../../shared/entities.js';
import type { Root } from '../../../shared/types.js';
import { DEFAULT_PAGE_LIMIT, projectReleaseDiff, projectSpecSnapshot } from './projection.js';
import type {
  EntityTypeFilter,
  IncludeFilter,
  MCPReleaseDiff,
  MCPSpecSnapshot,
} from './types.js';

export interface ReleaseToolsDeps {
  releaseService: ReleaseService;
  gitService: GitService;
  ws: WsEmitter;
  /**
   * 0.2.102: the project's page roots (all of them, not just the releasable
   * ones) — `release_diff` needs both to tell an UNKNOWN root id from a
   * NON-RELEASABLE one when it refuses a `roots`/`paths` filter.
   */
  roots: () => ReadonlyArray<Pick<Root, 'id' | 'releasable'>>;
}

const INCLUDE_VALUES = ['pages', 'entities'] as const;
/*
 * 0.2.11: `ENTITY_TYPE_VALUES` (a closed five-value zod enum) is gone. It
 * rejected any other type at the MCP boundary, so a caller could not ask about a
 * design system, a diagram or a plugin type even once the release layer began
 * capturing them. `z.string()` now carries the argument; the validation that
 * mattered — empty array, and the `entityTypes`-without-`entities` conflict —
 * lives in `validateFilters` and is unchanged. An unknown type is not an error,
 * it simply matches nothing, which is what a filter should do.
 */
const DEFAULT_INCLUDE: IncludeFilter[] = ['pages', 'entities'];

export function createReleaseToolsServer(deps: ReleaseToolsDeps): CapturedMcpServer {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    const code = err instanceof DomainError ? err.code : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    const hint = err instanceof DomainError ? err.hint : undefined;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: message, code, ...(hint ? { hint } : {}) }),
        },
      ],
      isError: true,
    };
  };

  const releaseCreate = mcpTool(
    'release_create',
    'Create a named release (snapshot of current spec state). Assigns release_id to all unreleased entity_version + file_version rows in one transaction. Always manual — there are no auto-triggers (M17 decyzja 9). Both name (UNIQUE) and description (non-empty) are required.',
    {
      name: z.string().describe('Release name, must be unique. e.g. "v1.0.0", "pre-launch"'),
      description: z
        .string()
        .describe(
          `Non-empty statement of the intent of this release, at most ${MAX_RELEASE_DESCRIPTION_LENGTH} characters. It is the raw material a later change brief is written from, so make it say what the release is about.`,
        ),
    },
    async (args) => {
      try {
        const release = deps.releaseService.createRelease(
          { name: String(args.name), description: String(args.description) },
          'agent',
        );
        deps.ws.broadcast({ kind: 'release:created', releaseId: release.id, name: release.name });
        // M28: agent-surface parity — same best-effort git commit as the HTTP
        // surface, with the outcome returned in `gitSync` (null when off/no repo).
        const gitSync = await deps.gitService.commitOnRelease(release);
        return ok({ ...release, gitSync });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const releaseList = mcpTool(
    'release_list',
    'List releases newest-first (paginated). Returns `{ releases, total }` where `total` is the full count before limit/offset. Per release: id, name, description, createdBy, createdAt.',
    {
      limit: z
        .number()
        .optional()
        .describe('Window size. Default 5, no upper limit. Negative → 400 INVALID_PAGINATION.'),
      offset: z
        .number()
        .optional()
        .describe('Window offset into the newest-first list. Default 0. Negative → 400 INVALID_PAGINATION.'),
    },
    async (args) => {
      try {
        const { limit, offset } = resolvePagination(args.limit, args.offset);
        const all = deps.releaseService.listReleases();
        return ok({ releases: all.slice(offset, offset + limit), total: all.length });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const releaseShow = mcpTool(
    'release_show',
    "Show a release's identification surface (release metadata + lists of entity slugs/page paths present at the release). Returns `MCPSpecSnapshot` — IDENTIFICATION only, not full entity/page data. To inspect the data, call `release_diff` (with this release as `to` and any earlier release — or `null` — as `from`). Accepts numeric id or release name. Filters: `include` (defaults to ['pages','entities']) trims the dimensions returned; `entityTypes` restricts entity types. Brief versions (`file_version.kind='brief'`) are excluded from `pages` (L2 invariant). RESPONSE BUDGET: a window cut short by the budget reports `truncationHint` naming the next `offset`; rows here are identity-only, so degradation is always a narrower window and never a poorer row.",
    {
      idOrName: z.union([z.string(), z.number()]).describe('Numeric id or release name'),
      include: z
        .array(z.enum(INCLUDE_VALUES))
        .optional()
        .describe(
          "Filter dimensions. Default ['pages','entities']. Empty array → 400 INVALID_INCLUDE_FILTER.",
        ),
      entityTypes: z
        .array(z.string())
        .optional()
        .describe(
          "Filter entity types. Default: every active entity type. Empty array → 400 INVALID_ENTITY_TYPES_FILTER. Passing this without 'entities' in `include` → 400 CONFLICTING_FILTERS.",
        ),
      limit: z
        .number()
        .optional()
        .describe(
          'Window size applied independently to entities[] and pages[]. Default 5, no upper limit. Negative → 400 INVALID_PAGINATION.',
        ),
      offset: z
        .number()
        .optional()
        .describe('Window offset applied independently to entities[] and pages[]. Default 0. Negative → 400 INVALID_PAGINATION.'),
    },
    async (args) => {
      try {
        const include = (args.include as IncludeFilter[] | undefined) ?? DEFAULT_INCLUDE;
        const entityTypes = args.entityTypes as EntityTypeFilter[] | undefined;
        validateFilters(args.include as IncludeFilter[] | undefined, entityTypes);
        const { limit, offset } = resolvePagination(args.limit, args.offset);

        const raw = deps.releaseService.getReleaseSnapshot(args.idOrName as number | string);
        return ok(
          projectSpecSnapshot(raw, { include, entityTypes }, { limit, offset }) satisfies MCPSpecSnapshot,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const releaseDiff = mcpTool(
    'release_diff',
    "Compute a SELF-CONTAINED structured diff between two releases. Heavy mode (default): each entity carries full `before`/`after` snapshots (per plugin's serializer); each modified section carries full `before`/`after` raw markdown. `entities[]`/`pages[]` are paginated independently by `limit`/`offset` (default 5), and `total: { entities?, pages? }` reports the full count after `include`/`entityTypes` filters, before the window. Light mode (`summaryOnly: true`): returns a delta MAP — `total` + identifiers `{ type, slug, name, op }` per entity and `{ rootId, path, op }` per page (incl. `op:'delete'`), WITHOUT `before`/`after`/`content`; the map is FULL and ignores `limit`. It is the guaranteed floor of degradation: for a map too large to fit in one response it PAGES from `offset` (never dropping a row) and says so via `truncationHint`. RESPONSE BUDGET: an item that does not fit is NEVER silently omitted — it comes back with its identity and `truncated: true`, an entity losing `before`/`after` WHOLE and a section keeping `content` cut as TEXT, while the envelope's `truncationHint` says how to retry. Absence from `entities[]`/`pages[]` therefore means one thing only: that thing did not change. Do NOT assume `op:'update'` implies `before`/`after` — check `truncated` first. A page entry carries `rootId` next to `path` in BOTH modes: a page's identity is the pair (rootId, path), `path` being relative to its root. Intended use: probe with `summaryOnly: true` to learn what changed, then fan out the heavy slices to subagents — three slicing axes: `entityTypes`, the `limit`/`offset` window, and `paths` (single pages by FULL key `<rootId>/<path>`). `paths` + `summaryOnly: true` is an intended pattern, not an edge case: the delta map for just those pages. Pass `from: null` for the initial brief (synthetic empty `from`; all entries become `op:'create'` with `before` omitted). `from === to` returns an empty diff. There is NO `line_diff`. Pass `toIdOrName: \"current\"` to diff a release against the live, not-yet-released state (HEAD): that `after` side is not frozen, so such a diff does not reproduce later. `current` is a reserved release name and never collides with a real one.",
    {
      fromIdOrName: z
        .union([z.string(), z.number(), z.null()])
        .describe(
          'Earlier release id or name. `null` = initial brief (compare to empty state — all entries become op:create).',
        ),
      toIdOrName: z
        .union([z.string(), z.number()])
        .describe(
          'Later release id or name. The literal `"current"` compares against the live, not-yet-released state (HEAD) instead of a release; it is resolved before the name lookup and is a reserved release name, so it can never be shadowed by a real one. `fromIdOrName: null` together with `"current"` → 400 INVALID_DIFF_RANGE.',
        ),
      include: z
        .array(z.enum(INCLUDE_VALUES))
        .optional()
        .describe(
          "Filter dimensions. Default ['pages','entities']. Empty array → 400 INVALID_INCLUDE_FILTER.",
        ),
      entityTypes: z
        .array(z.string())
        .optional()
        .describe(
          "Filter entity types. Default: every active entity type. Empty array → 400 INVALID_ENTITY_TYPES_FILTER. Passing this without 'entities' in `include` → 400 CONFLICTING_FILTERS.",
        ),
      summaryOnly: z
        .boolean()
        .optional()
        .describe(
          'Default false. true = light delta-map: only `total` + identifiers `{ type, slug, name, op }` / `{ rootId, path, op }` (incl. deletes), no before/after/content. Full lists — ignores `limit`. `offset` IS honoured, as the resume cursor for a map too big for one response (`truncationHint` names the next offset).',
        ),
      roots: z
        .array(z.string())
        .optional()
        .describe(
          'Narrow the PAGES dimension to these page root ids (file_version.rootId). Default: all releasable roots. Does not affect the entities dimension. Empty array, an unknown root id, or a non-releasable root → 400 INVALID_ROOTS_FILTER (never silently skipped; the refusal lists the releasable roots). Mutually exclusive with `paths`.',
        ),
      paths: z
        .array(z.string())
        .optional()
        .describe(
          "Narrow the PAGES dimension to single pages. Each element is a page's FULL key `<rootId>/<relPath>` and addresses exactly one page file — a directory prefix is not accepted. Mutually exclusive with `roots`, and rejected when `include` does not carry 'pages'. An empty array, an element without a root prefix, an unknown root id, or a non-releasable root is rejected. Does not affect the entities dimension. A well-formed key unchanged (or absent) on both sides is NOT an error — it yields no page entry and `total.pages: 0`. Errors: 400 INVALID_PATHS_FILTER, 400 CONFLICTING_FILTERS.",
        ),
      limit: z
        .number()
        .optional()
        .describe(
          'Window size applied independently to entities[] and pages[] (heavy mode only). Default 5, no upper limit. Negative → 400 INVALID_PAGINATION.',
        ),
      offset: z
        .number()
        .optional()
        .describe(
          'Window offset applied independently to entities[] and pages[]. Default 0. Beyond total → empty list + total. Negative → 400 INVALID_PAGINATION. In light mode (`summaryOnly: true`) this is the resume cursor for an identity map that does not fit in one response.',
        ),
    },
    async (args) => {
      try {
        // Validate pagination BEFORE the summaryOnly branch — negative limit/offset
        // is a 400 even though `summaryOnly: true` later ignores the window.
        // The filters come after it (0.2.102 order).
        const { limit, offset } = resolvePagination(args.limit, args.offset);
        const summaryOnly = args.summaryOnly === true;

        const include = (args.include as IncludeFilter[] | undefined) ?? DEFAULT_INCLUDE;
        const entityTypes = args.entityTypes as EntityTypeFilter[] | undefined;
        const roots = args.roots as string[] | undefined;
        const paths = args.paths as string[] | undefined;
        validateDiffFilters(args.include as IncludeFilter[] | undefined, entityTypes, roots, paths, deps.roots());

        const fromIdOrName = args.fromIdOrName as number | string | null;
        const toIdOrName = args.toIdOrName as number | string;

        // The reserved literal is settled BEFORE anything resolves a name or an
        // id. The order is the whole guarantee: resolve first and a real release
        // named `current` — which `createRelease` refuses, but an older database
        // or a hand-written row could still hold — would shadow the literal and
        // silently answer a historical diff to a caller asking about HEAD.
        const isCurrent = toIdOrName === CURRENT_RELEASE_NAME;
        if (isCurrent && fromIdOrName === null) {
          // "From nothing to the working tree" has no useful reading: the initial
          // brief is a claim about a FROZEN pair, and this pairing would answer it
          // with a snapshot of whatever is on disk right now.
          throw new DomainError(
            'INVALID_DIFF_RANGE',
            'fromIdOrName: null cannot be combined with toIdOrName: "current"',
          );
        }

        // Two engines, ONE projection. `getUnreleasedDiff` returns the same
        // `RawDelta` as `getReleaseDiff`, so the envelope the caller reads does
        // not fork — only `to.id` (null) says which branch produced it.
        const raw = isCurrent
          ? await deps.releaseService.getUnreleasedDiff(fromIdOrName, { roots, paths })
          : await deps.releaseService.getReleaseDiff(fromIdOrName, toIdOrName, { roots, paths });
        const toSnap = isCurrent
          ? deps.releaseService.getCurrentSnapshot()
          : deps.releaseService.getReleaseSnapshot(toIdOrName);
        const fromSnap =
          fromIdOrName === null ? null : deps.releaseService.getReleaseSnapshot(fromIdOrName);

        return ok(
          projectReleaseDiff(raw, fromSnap, toSnap, { include, entityTypes }, {
            summaryOnly,
            limit,
            offset,
          }) satisfies MCPReleaseDiff,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const releaseUpdate = mcpTool(
    'release_update',
    `Update the LATEST release only — older releases are frozen. Mutates name/description in-place and optionally pulls all unreleased entity_version + file_version rows (release_id IS NULL) into this release. 409 RELEASE_FROZEN if id != MAX(id). 409 RELEASE_NAME_CONFLICT on rename collision. 400 RELEASE_DESCRIPTION_TOO_LONG / RELEASE_DESCRIPTION_REQUIRED when a given description is over ${MAX_RELEASE_DESCRIPTION_LENGTH} characters or empty.`,
    {
      idOrName: z.union([z.string(), z.number()]).describe('Numeric id or release name'),
      name: z.string().optional().describe('New name (must be unique). Omit to leave unchanged.'),
      description: z
        .string()
        .optional()
        .describe(
          `New non-empty description of the release intent, at most ${MAX_RELEASE_DESCRIPTION_LENGTH} characters. Omit to leave unchanged.`,
        ),
      assignUnreleased: z
        .boolean()
        .optional()
        .describe(
          'When true, assigns all entity_version/file_version rows where release_id IS NULL to this release. No-op when queue is empty.',
        ),
    },
    async (args) => {
      try {
        const release = await deps.releaseService.updateRelease({
          idOrName: args.idOrName as number | string,
          name: args.name as string | undefined,
          description: args.description as string | undefined,
          assignUnreleased: args.assignUnreleased as boolean | undefined,
        });
        deps.ws.broadcast({ kind: 'release:updated', releaseId: release.id, name: release.name });
        return ok(release);
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'release-tools',
    tools: [releaseCreate, releaseList, releaseShow, releaseDiff, releaseUpdate],
  });
}

const DEFAULT_OFFSET = 0;

/**
 * Resolve `limit`/`offset` for the MCP-only pagination of `release_list` /
 * `release_show` / `release_diff`. Negative values are a loud 400 `INVALID_PAGINATION` (no
 * silent clamp), consistent with the rest of M17's jaskrawe błędy. Zod keeps
 * these loose (`z.number()`) so negatives reach this check rather than failing
 * as a generic Zod error.
 */
export function resolvePagination(limit: unknown, offset: unknown): { limit: number; offset: number } {
  const l = typeof limit === 'number' ? limit : DEFAULT_PAGE_LIMIT;
  const o = typeof offset === 'number' ? offset : DEFAULT_OFFSET;
  if (l < 0 || o < 0) {
    throw new DomainError('INVALID_PAGINATION', 'limit and offset must be >= 0');
  }
  return { limit: l, offset: o };
}

function validateFilters(
  include: IncludeFilter[] | undefined,
  entityTypes: EntityTypeFilter[] | undefined,
): void {
  if (include !== undefined && include.length === 0) {
    throw new DomainError('INVALID_INCLUDE_FILTER', 'include must not be an empty array');
  }
  if (entityTypes !== undefined && entityTypes.length === 0) {
    throw new DomainError('INVALID_ENTITY_TYPES_FILTER', 'entityTypes must not be an empty array');
  }
  if (entityTypes !== undefined) {
    const effectiveInclude = include ?? DEFAULT_INCLUDE;
    if (!effectiveInclude.includes('entities')) {
      throw new DomainError(
        'CONFLICTING_FILTERS',
        "entityTypes filter requires 'entities' in include",
      );
    }
  }
}

/**
 * 0.2.102: `release_diff`'s filter validation, in the documented order — empty
 * `include`/`entityTypes`/`roots`/`paths` first, then the conflicts
 * (`entityTypes` without 'entities', `paths` without 'pages', `paths` together
 * with `roots`), then an unknown or non-releasable root. `roots` and `paths`
 * REFUSE such a root instead of silently skipping it, and the refusal names the
 * releasable roots. `release_show` keeps the narrower `validateFilters`.
 */
function validateDiffFilters(
  include: IncludeFilter[] | undefined,
  entityTypes: EntityTypeFilter[] | undefined,
  roots: string[] | undefined,
  paths: string[] | undefined,
  allRoots: ReadonlyArray<Pick<Root, 'id' | 'releasable'>>,
): void {
  const releasable = allRoots.filter((r) => r.releasable).map((r) => r.id);
  const available = `releasable roots: [${releasable.join(', ')}]`;
  const refuse = (code: string, message: string): never => {
    throw new DomainError(code, `${message} (${available})`, available);
  };

  if (include !== undefined && include.length === 0) {
    throw new DomainError('INVALID_INCLUDE_FILTER', 'include must not be an empty array');
  }
  if (entityTypes !== undefined && entityTypes.length === 0) {
    throw new DomainError('INVALID_ENTITY_TYPES_FILTER', 'entityTypes must not be an empty array');
  }
  if (roots !== undefined && roots.length === 0) refuse('INVALID_ROOTS_FILTER', 'roots must not be an empty array');
  if (paths !== undefined && paths.length === 0) refuse('INVALID_PATHS_FILTER', 'paths must not be an empty array');

  const effectiveInclude = include ?? DEFAULT_INCLUDE;
  if (entityTypes !== undefined && !effectiveInclude.includes('entities')) {
    throw new DomainError('CONFLICTING_FILTERS', "entityTypes filter requires 'entities' in include");
  }
  if (paths !== undefined && !effectiveInclude.includes('pages')) {
    throw new DomainError('CONFLICTING_FILTERS', "paths filter requires 'pages' in include");
  }
  if (paths !== undefined && roots !== undefined) {
    throw new DomainError('CONFLICTING_FILTERS', 'paths and roots are mutually exclusive — pass one of them');
  }

  const rootProblem = (id: string): string | null => {
    const root = allRoots.find((r) => r.id === id);
    if (!root) return `unknown root '${id}'`;
    if (!root.releasable) return `root '${id}' is not releasable`;
    return null;
  };
  for (const id of roots ?? []) {
    const problem = rootProblem(id);
    if (problem) refuse('INVALID_ROOTS_FILTER', `roots: ${problem}`);
  }
  for (const key of paths ?? []) {
    const parsed = splitPageKey(key);
    if (!parsed) {
      refuse(
        'INVALID_PATHS_FILTER',
        `paths: '${key}' has no root prefix — expected a page's full key <rootId>/<relPath>`,
      );
    }
    const problem = rootProblem(parsed!.rootId);
    if (problem) refuse('INVALID_PATHS_FILTER', `paths: '${key}': ${problem}`);
  }
}
