/**
 * MCP server `release-tools` — exposes M17 release operations to agents
 * (chat, external MCP clients). Mirrors `m17mcpprj`: 5 tools — create, list,
 * show, diff, update. `release_restore` is intentionally absent (decyzja 9 +
 * `m17open01` open #3 — restore is human-initiated only).
 *
 * `release_diff` / `release_show` project the raw L2 shape (`RawDelta` /
 * `SpecSnapshot`) onto a self-contained MCP shape (`MCPReleaseDiff` /
 * `MCPSpecSnapshot`). The projection is what makes briefs interpretable after
 * HEAD advances beyond the release pair. 2.1.11: that payload belongs to the
 * OPERATION, not to this channel — REST with `view=operation` and the
 * `c4s release-*` commands return the same one; REST without `view` and the UI
 * keep consuming the raw L2 shape for render-time `line_diff`.
 *
 * 0.2.62: `release_diff` grew a second engine — `toIdOrName: "current"` diffs a
 * release against the live, unreleased state. It costs this server the property
 * that made its toolset safe to hand a subagent without thinking: "release-tools
 * are historical by definition" is no longer true of the WHOLE server, one branch
 * of one tool answers with the present. Nothing here changes to compensate; what
 * changes is that `diff-explore`'s "historical diff only" guarantee rests on its
 * PROMPT and on the absence of the entity graph from its toolset (2.1.5: it holds
 * no `Read` either), rather than on the shape of this server alone.
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../../plugin-runtime/index.js';
import { z } from 'zod';
import type { ReleaseService } from '../../services/release.js';
import type { GitService } from '../../services/git.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
import { MAX_RELEASE_DESCRIPTION_LENGTH } from '../../../shared/entities.js';
import type { Root } from '../../../shared/types.js';
import {
  INCLUDE_VALUES,
  releaseDiffOperation,
  releaseListOperation,
  releaseShowOperation,
} from '../../services/release-operations.js';
import type { EntityTypeFilter, IncludeFilter, MCPReleaseDiff, MCPSpecSnapshot } from './types.js';

// 2.1.11 — the window helpers moved with the operations; re-exported for callers
// that still import them from here.
export {
  refuseNonPageRoots,
  resolvePagination,
  resolveSectionWindow,
} from '../../services/release-operations.js';

export interface ReleaseToolsDeps {
  releaseService: ReleaseService;
  gitService: GitService;
  ws: WsEmitter;
  /**
   * 2.1.8: the project's PAGE roots (`kind: pages`) — the only roots a
   * `roots`/`paths` filter may name. Any other id (unknown, or a system root
   * such as `plans`/`entities`) is refused with this list.
   */
  roots: () => ReadonlyArray<Pick<Root, 'id'>>;
}

/*
 * 0.2.11: `ENTITY_TYPE_VALUES` (a closed five-value zod enum) is gone. It
 * rejected any other type at the MCP boundary, so a caller could not ask about a
 * design system, a diagram or a plugin type even once the release layer began
 * capturing them. `z.string()` now carries the argument; an unknown type is not
 * an error, it simply matches nothing, which is what a filter should do.
 *
 * 2.1.11: filter validation, windows, projection and the budget live in
 * `services/release-operations.ts`; the read tools below are thin calls into it,
 * the same functions the REST routes call with `view=operation`.
 */

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
        return ok(
          releaseListOperation(deps, { limit: args.limit as number | undefined, offset: args.offset as number | undefined }),
        );
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
        return ok(
          releaseShowOperation(deps, {
            releaseName: args.idOrName as number | string,
            include: args.include as IncludeFilter[] | undefined,
            entityTypes: args.entityTypes as EntityTypeFilter[] | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          }) satisfies MCPSpecSnapshot,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const releaseDiff = mcpTool(
    'release_diff',
    "Compute a self-contained structured diff between two releases, or between a release and the current unreleased state. Heavy mode (default) carries, per changed entity, the FULL `before`/`after` snapshots frozen at each release, and per changed page section the section text with inline `<before_change>`/`<after_change>` markers; compare the snapshots yourself. The payload already carries historical state, so do not drill into current files or the live entity graph to explain a past change. `toIdOrName: \"current\"` diffs against the live, not-yet-released state (HEAD); that side is not frozen and does not reproduce later. Light mode (`summaryOnly: true`) returns a complete delta MAP, deletions included, windows ignored: `total` plus `{ type, slug, name, op }` per entity and `{ rootId, path, op, sections, size }` per page, where `size` is the length of the page's changed-section content in characters. With exactly one entry in `paths` it also returns that page's section map, with a `size` per section. Pattern: probe with `summaryOnly`, use `size` to partition into disjoint slices, then pull each slice by `entityTypes`, `paths` and the `limit`/`offset` page window. Read a large page with `paths` set to it and the `sectionOffset`/`sectionLimit` section window; `sectionLimit: 1` reads it section by section, by choice and not only after truncation. `limit` (default 5) and `offset` window entities and pages independently; `total` counts after filters, before the window, and with one path `total.sections` counts its changed sections. A window past the end returns an empty list with `total` present. `fromIdOrName: null` gives the initial diff (every entry `op: 'create'`); `from === to` gives an empty diff. Briefs and patches never appear. Read-only.",
    {
      fromIdOrName: z
        .union([z.string(), z.number(), z.null()])
        .describe(
          'Earlier release id or name. `null`, `"null"` and `"initial"` are equivalent and name the empty state (initial diff — all entries become op:create). `"current"` is not legal here → 400 INVALID_DIFF_RANGE.',
        ),
      toIdOrName: z
        .union([z.string(), z.number()])
        .describe(
          'Later release id or name. The literal `"current"` compares against the live, not-yet-released state (HEAD) instead of a release; it is resolved before the name lookup and is a reserved release name, so it can never be shadowed by a real one. The empty state (`null` / `"null"` / `"initial"`) on the left together with `"current"` → 400 INVALID_DIFF_RANGE; `"initial"` / `"null"` here → 400 INVALID_DIFF_RANGE.',
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
      slugs: z
        .array(z.string())
        .optional()
        .describe(
          "Narrow the ENTITIES dimension to these bare slugs of ONE type — requires exactly one element in `entityTypes` and 'entities' in `include` (otherwise 400 CONFLICTING_FILTERS). Empty array or an empty element → 400 INVALID_SLUGS_FILTER. Narrows the response, not the computation; a slug unchanged (or absent) on both sides yields no entry and `total.entities: 0`, not an error. With `fromIdOrName: null` a present entity comes back as one `op: 'create'` entry whose `after` is its state in `to`. Does not touch the pages dimension, so it combines with `paths`.",
        ),
      summaryOnly: z
        .boolean()
        .optional()
        .describe(
          'When true, return the light delta map — identifiers plus op, and per page `sections` (changed-section count) and `size` (their content length in characters); deletions included, no before/after/content. With exactly one element in `paths`, the page row also carries `sectionMap`: one row per changed section with its identity and `size`. The map is always complete and ignores limit/offset and the section window.',
        ),
      roots: z
        .array(z.string())
        .optional()
        .describe(
          'Narrow the PAGES dimension to these page root ids (file_version.rootId). Default: every page root. Does not affect the entities dimension. Empty array, an unknown root id, or an id that is not a page root (e.g. plans, briefs, patches, entities, releases) → 400 INVALID_ROOTS_FILTER (never silently skipped; the refusal lists the page roots). Mutually exclusive with `paths`.',
        ),
      paths: z
        .array(z.string())
        .optional()
        .describe(
          "Narrow the PAGES dimension to single pages. Each element is a page's FULL key `<rootId>/<relPath>` and addresses exactly one page file — a directory prefix is not accepted. Mutually exclusive with `roots`, and rejected when `include` does not carry 'pages'. An empty array, an element without a root prefix, an unknown root id, or a root that is not a page root is rejected. Does not affect the entities dimension. A well-formed key unchanged (or absent) on both sides is NOT an error — it yields no page entry and `total.pages: 0`. Errors: 400 INVALID_PATHS_FILTER, 400 CONFLICTING_FILTERS. Exactly one element enables the section window and, in light mode, the section map.",
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
      sectionOffset: z
        .number()
        .optional()
        .describe(
          "Default 0. Start of the section window in the ONE page named by `paths`; positions count in the order `sections[]` comes back without a window. Requires exactly one element in `paths`, otherwise 400 CONFLICTING_FILTERS. Negative → 400 INVALID_PAGINATION. A window past the end returns an empty section list with `total.sections` present. The page's `frontmatter`/`xmlRefs` come only in the window starting at 0. Ignored with `summaryOnly: true`.",
        ),
      sectionLimit: z
        .number()
        .optional()
        .describe(
          'Size of the section window. Default: every section from `sectionOffset` on. `1` reads the page section by section, usable by choice whatever the page size. Same conditions as `sectionOffset`.',
        ),
    },
    async (args) => {
      try {
        return ok(
          (await releaseDiffOperation(deps, {
            fromReleaseName: args.fromIdOrName as number | string | null,
            toReleaseName: args.toIdOrName as number | string,
            include: args.include as IncludeFilter[] | undefined,
            entityTypes: args.entityTypes as EntityTypeFilter[] | undefined,
            slugs: args.slugs as string[] | undefined,
            roots: args.roots as string[] | undefined,
            paths: args.paths as string[] | undefined,
            summaryOnly: args.summaryOnly as boolean | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
            sectionOffset: args.sectionOffset as number | undefined,
            sectionLimit: args.sectionLimit as number | undefined,
          })) satisfies MCPReleaseDiff,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  const releaseUpdate = mcpTool(
    'release_update',
    `Update the LATEST release only — older releases are frozen. Mutates name/description in-place and optionally pulls all unreleased entity_version + file_version rows (release_id IS NULL) into this release. 409 RELEASE_FROZEN if the release is not the latest on the release axis (latest created_at, tie by id). 409 RELEASE_NAME_CONFLICT on rename collision. 400 RELEASE_DESCRIPTION_TOO_LONG / RELEASE_DESCRIPTION_REQUIRED when a given description is over ${MAX_RELEASE_DESCRIPTION_LENGTH} characters or empty.`,
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
