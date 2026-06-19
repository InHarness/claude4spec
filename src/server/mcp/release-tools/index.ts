/**
 * MCP server `release-tools` — exposes M17 release operations to agents
 * (chat, external MCP clients). Mirrors `m17mcp001`: 5 tools — create, list,
 * show, diff, update. `release_restore` is intentionally absent (decyzja 9 +
 * `m17open01` open #3 — restore is human-initiated only).
 *
 * `release_diff` / `release_show` project the raw L2 shape (`RawDelta` /
 * `SpecSnapshot`) onto a self-contained MCP shape (`MCPReleaseDiff` /
 * `MCPSpecSnapshot`). This is the only consumer of `release-tools` in brief
 * threads; the projection is what makes briefs interpretable after HEAD
 * advances beyond the release pair. REST (`/api/releases/...`) and UI keep
 * consuming the raw L2 shape for render-time `line_diff`.
 */

import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { ReleaseService } from '../../services/release.js';
import type { GitService } from '../../services/git.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
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
}

const INCLUDE_VALUES = ['pages', 'entities'] as const;
const ENTITY_TYPE_VALUES = ['endpoint', 'dto', 'database-table', 'ui-view', 'ac'] as const;
const DEFAULT_INCLUDE: IncludeFilter[] = ['pages', 'entities'];

export function createReleaseToolsServer(deps: ReleaseToolsDeps): McpServerInstance {
  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    const code = err instanceof DomainError ? err.code : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }) }],
      isError: true,
    };
  };

  const releaseCreate = mcpTool(
    'release_create',
    'Create a named release (snapshot of current spec state). Assigns release_id to all unreleased entity_version + page_version rows in one transaction. Always manual — there are no auto-triggers (M17 decyzja 9). Both name (UNIQUE) and description (non-empty) are required.',
    {
      name: z.string().describe('Release name, must be unique. e.g. "v1.0.0", "pre-launch"'),
      description: z.string().describe('Non-empty intent of the release — surfaced to M18 brief-builder'),
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
    "Show a release's identification surface (release metadata + lists of entity slugs/page paths present at the release). Returns `MCPSpecSnapshot` — IDENTIFICATION only, not full entity/page data. To inspect the data, call `release_diff` (with this release as `to` and any earlier release — or `null` — as `from`). Accepts numeric id or release name. Filters: `include` (defaults to ['pages','entities']) trims the dimensions returned; `entityTypes` restricts entity types. Brief versions (`page_version.kind='brief'`) are excluded from `pages` (L2 invariant).",
    {
      idOrName: z.union([z.string(), z.number()]).describe('Numeric id or release name'),
      include: z
        .array(z.enum(INCLUDE_VALUES))
        .optional()
        .describe(
          "Filter dimensions. Default ['pages','entities']. Empty array → 400 INVALID_INCLUDE_FILTER.",
        ),
      entityTypes: z
        .array(z.enum(ENTITY_TYPE_VALUES))
        .optional()
        .describe(
          "Filter entity types. Default all 5 types. Empty array → 400 INVALID_ENTITY_TYPES_FILTER. Passing this without 'entities' in `include` → 400 CONFLICTING_FILTERS.",
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
    "Compute a SELF-CONTAINED structured diff between two releases. Heavy mode (default): each entity carries full `before`/`after` snapshots (per plugin's serializer); each modified section carries full `before`/`after` raw markdown. `entities[]`/`pages[]` are paginated independently by `limit`/`offset` (default 5), and `total: { entities?, pages? }` reports the full count after `include`/`entityTypes` filters, before the window. Light mode (`summaryOnly: true`): returns a delta MAP — `total` + identifiers `{ type, slug, name, op }` per entity and `{ path, op }` per page (incl. `op:'delete'`), WITHOUT `before`/`after`/`content`; the map is FULL and ignores `limit`/`offset`. Intended use: probe with `summaryOnly: true` to learn what changed, then fan out the heavy slices (`entityTypes` and/or `limit`/`offset`) to subagents. Pass `from: null` for the initial brief (synthetic empty `from`; all entries become `op:'create'` with `before` omitted). `from === to` returns an empty diff. There is NO `line_diff`.",
    {
      fromIdOrName: z
        .union([z.string(), z.number(), z.null()])
        .describe(
          'Earlier release id or name. `null` = initial brief (compare to empty state — all entries become op:create).',
        ),
      toIdOrName: z.union([z.string(), z.number()]).describe('Later release id or name'),
      include: z
        .array(z.enum(INCLUDE_VALUES))
        .optional()
        .describe(
          "Filter dimensions. Default ['pages','entities']. Empty array → 400 INVALID_INCLUDE_FILTER.",
        ),
      entityTypes: z
        .array(z.enum(ENTITY_TYPE_VALUES))
        .optional()
        .describe(
          "Filter entity types. Default all 5 types. Empty array → 400 INVALID_ENTITY_TYPES_FILTER. Passing this without 'entities' in `include` → 400 CONFLICTING_FILTERS.",
        ),
      summaryOnly: z
        .boolean()
        .optional()
        .describe(
          'Default false. true = light delta-map: only `total` + identifiers `{ type, slug, name, op }` / `{ path, op }` (incl. deletes), no before/after/content. Full lists — ignores limit/offset.',
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
          'Window offset applied independently to entities[] and pages[] (heavy mode only). Default 0. Beyond total → empty list + total. Negative → 400 INVALID_PAGINATION.',
        ),
    },
    async (args) => {
      try {
        const include = (args.include as IncludeFilter[] | undefined) ?? DEFAULT_INCLUDE;
        const entityTypes = args.entityTypes as EntityTypeFilter[] | undefined;
        validateFilters(args.include as IncludeFilter[] | undefined, entityTypes);
        // Validate pagination BEFORE the summaryOnly branch — negative limit/offset
        // is a 400 even though `summaryOnly: true` later ignores the window.
        const { limit, offset } = resolvePagination(args.limit, args.offset);
        const summaryOnly = args.summaryOnly === true;

        const fromIdOrName = args.fromIdOrName as number | string | null;
        const toIdOrName = args.toIdOrName as number | string;

        const raw = deps.releaseService.getReleaseDiff(fromIdOrName, toIdOrName);
        const toSnap = deps.releaseService.getReleaseSnapshot(toIdOrName);
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
    'Update the LATEST release only — older releases are frozen. Mutates name/description in-place and optionally pulls all unreleased entity_version + page_version rows (release_id IS NULL) into this release. 409 RELEASE_FROZEN if id != MAX(id). 409 RELEASE_NAME_CONFLICT on rename collision.',
    {
      idOrName: z.union([z.string(), z.number()]).describe('Numeric id or release name'),
      name: z.string().optional().describe('New name (must be unique). Omit to leave unchanged.'),
      description: z.string().optional().describe('New description (non-empty). Omit to leave unchanged.'),
      assignUnreleased: z
        .boolean()
        .optional()
        .describe(
          'When true, assigns all entity_version/page_version rows where release_id IS NULL to this release. No-op when queue is empty.',
        ),
    },
    async (args) => {
      try {
        const release = deps.releaseService.updateRelease({
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
