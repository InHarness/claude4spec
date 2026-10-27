import { Router } from 'express';
import type { BriefService } from '../services/brief.js';
import type { PatchService } from '../services/patch.js';
import type { PlanService } from '../services/plan.js';
import type { FileVersionService, FileVersionListItem, FileVersionDetail } from '../services/file-version.js';
import type { ChatService, ArtifactThreadColumn } from '../services/chat.js';
import { artifactEntry, artifactHeaderContract, artifactRootId, type ArtifactKind } from '../services/artifact-registry.js';
import type {
  ArtifactFrontmatterUpdateRequest,
  ArtifactListItem,
  ArtifactResponse,
  ArtifactWriteResponse,
  ArtifactThreadListItem,
} from '../../shared/entities.js';
import { DomainError } from '../services/tags.js';
import type { ArtifactRange } from '../services/artifact-read.js';

/**
 * 2.1.48 (M36 `r2nekhf5`) — what the detail route asks a kind's service for.
 * The editor projection is `{ full: true }`; the operation projection is the
 * `get_<kind>` read in the `rest` channel (window + budget, hint in the route's
 * spelling). Passed to the services as is.
 */
type ArtifactDetailRead =
  | { full: true }
  | { range: ArtifactRange | undefined; channel: 'rest' };

/**
 * M36 — generic REST family replacing the per-kind `/api/briefs/*`/`/api/patches/*`
 * routes (7 endpoints, parametrized by `:kind`). `BriefService`/`PatchService`/
 * `PlanService` stay the kind-specific implementations (each has its own
 * creation flow / query-filter semantics that don't generalize cleanly) — this
 * router is a thin adapter layer translating each service's internal shape to
 * the generic `ArtifactResponse`/`ArtifactListItem` DTOs at the REST boundary.
 *
 * `plan`'s generic `/api/artifacts/plan/*` endpoints (list/detail/versions/
 * content/frontmatter) replace the pre-0.1.127 bespoke `GET /api/plans`,
 * `GET/PUT/PATCH /api/plans/:planId` routes — but `plan`'s own thread-binding
 * flows (`create-thread`, `last-thread`, `by-thread`) stay bespoke in
 * `routes/plans.ts` (richer semantics than the generic `POST .../threads`:
 * the `plan_path` attach; 0.1.138 removed the `execute` endpoint that used to
 * live there too), so this adapter's `createThread` exists only to satisfy
 * `ArtifactKindAdapter` — it delegates to the exact same `PlanService` method
 * `routes/plans.ts` calls, so there's no behavior fork between the two paths.
 *
 * 0.1.139: `GET /:kind/<path>/threads` joined the family as its 8th endpoint,
 * and thread *listing* left the adapter entirely — every kind resolves through
 * `artifactRegistry[kind].binding.threadColumn` to the single
 * `ChatService.listThreadsByArtifact` query, so there is nothing per-kind left
 * to dispatch on. `GET /api/plans/:slug/threads` was retired with it.
 */
interface ArtifactKindAdapter {
  list(query: Record<string, unknown>): ArtifactListItem[];
  /** The detail route's read — see {@link parseDetailProjection} for the two projections. */
  get(path: string, read: ArtifactDetailRead): Promise<ArtifactResponse>;
  updateContent(path: string, content: string, expectedHash: string): Promise<ArtifactWriteResponse>;
  updateFrontmatter(path: string, frontmatter: Record<string, unknown>): Promise<ArtifactWriteResponse>;
  createThread(path: string, name?: string | null): Promise<{ threadId: string }>;
  /**
   * 2.1.13 — a kind whose catalog rows give its version renderings their own
   * codes (plan: `list_plan_versions` / `get_plan_version`, PLAN_NOT_FOUND +
   * INVALID_ARGUMENT) answers them itself; a kind without these falls back to
   * the generic `file_version` reads below (NOT_FOUND-free list,
   * VERSION_NOT_FOUND / VALIDATION on a single version).
   */
  listVersions?(path: string): Promise<FileVersionListItem[]>;
  getVersion?(path: string, rawVersion: string): Promise<FileVersionDetail>;
}

export interface ArtifactsRouterDeps {
  brief: BriefService;
  patch: PatchService;
  plan: PlanService;
  pageVersions: FileVersionService;
  chat: ChatService;
}


/**
 * `?applied=true|false` — the plan/patch execution-flag filter (0.2.14), the
 * same shape as brief's `?implemented=`. Omitting the parameter means "all";
 * per L4's Optional filters convention there is no `any`/`all` literal.
 */
function parseAppliedFilter(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new DomainError('VALIDATION', `?applied must be 'true' or 'false' (omit for all)`);
}

function buildBriefAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { brief: briefs } = deps;
  return {
    list(query) {
      let implemented: boolean | undefined;
      if (query.implemented === undefined) {
        implemented = undefined;
      } else if (query.implemented === 'true') {
        implemented = true;
      } else if (query.implemented === 'false') {
        implemented = false;
      } else {
        throw new DomainError('VALIDATION', `?implemented must be 'true' or 'false' (omit for all)`);
      }
      // Maps listBriefs()'s already-fetched frontmatter/hash directly — no
      // second frontmatter-indexer lookup or file_version query per row.
      // The ORDER is the owning module's (M21, release axis); this endpoint
      // declares none of its own, so it must never re-sort.
      const rows = briefs.listBriefs({ implemented }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.lastModifiedAt,
      }));
      /*
       * 2.1.13 — the `list_briefs` row pages with `limit` / `offset`, the window
       * taken AFTER the `implemented` filter (so a page never comes back short
       * because filtered rows were counted). Applied only when the caller asks:
       * the unpaged list is what the UI and `c4s list-briefs` (which counts
       * `total` over it) have always read.
       */
      if (query.limit === undefined && query.offset === undefined) return rows;
      const { limit, offset } = parsePaging({
        limit: query.limit ?? String(rows.length),
        offset: query.offset,
      });
      return rows.slice(offset, offset + limit);
    },
    async get(path, read) {
      const b = await briefs.getBrief(path, read);
      return {
        path: b.path,
        frontmatter: b.frontmatter,
        body: b.body,
        content: b.content,
        hash: b.hash,
        ...(b.truncated ? { truncated: b.truncated, truncationHint: b.truncationHint } : {}),
      };
    },
    async updateContent(path, content, expectedHash) {
      await briefs.updateContent({ path, content, expectedHash, changedBy: 'user' });
      const b = await briefs.getBrief(path);
      return { path: b.path, frontmatter: b.frontmatter, hash: b.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      const implemented =
        typeof frontmatter.implemented === 'boolean' ? frontmatter.implemented : undefined;
      const b = await briefs.updateFrontmatter({ path, patch: { implemented }, changedBy: 'user' });
      return { path: b.path, frontmatter: b.frontmatter, hash: b.hash };
    },
    /**
     * 2.1.13 — the rest renderings of `list_brief_versions` / `get_brief_version`
     * answer with their rows' codes: an unknown path is `BRIEF_NOT_FOUND` (never
     * an empty list), a version off the history `INVALID_ARGUMENT` stating 1..N
     * (ASSUMPTION:dev-0003) — not the generic VERSION_NOT_FOUND / VALIDATION.
     * The list keeps the family's newest-first order.
     */
    async listVersions(path) {
      return briefs.listVersionsAddressed(path);
    },
    async getVersion(path, rawVersion) {
      return briefs.getVersionAddressed(path, /^\d+$/.test(rawVersion) ? Number(rawVersion) : Number.NaN);
    },
    async createThread(path, name) {
      // Watek bez pliku briefu to sierota: `createThreadForBrief` wstawia wiersz
      // z samej sciezki, a `agent-turn` polyka pozniejszy NOT_FOUND w warn — wiec
      // literowka w `--brief` konczyla sie zielona, platna tura bez snapshotu.
      // `getBrief` przywraca 404 zanim cokolwiek powstanie.
      await briefs.getBrief(path);
      return briefs.createThreadForBrief({ path, name: name ?? null });
    },
  };
}

function buildPatchAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { patch: patches } = deps;
  return {
    list(query) {
      const brief = typeof query.brief === 'string' ? query.brief : undefined;
      const applied = parseAppliedFilter(query.applied);
      // Maps listPatches()'s already-fetched frontmatter/hash directly — no
      // second frontmatter-indexer lookup or file_version query per row.
      return patches.listPatches({ brief, applied }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.lastModified,
      }));
    },
    async get(path, read) {
      const p = await patches.getPatch(path, read);
      return {
        path: p.path,
        frontmatter: p.frontmatter,
        body: p.body,
        content: p.content,
        hash: p.hash,
        ...(p.truncated ? { truncated: p.truncated, truncationHint: p.truncationHint } : {}),
      };
    },
    async updateContent(path, content, expectedHash) {
      const p = await patches.updateContent({ path, content, expectedHash });
      return { path: p.path, frontmatter: p.frontmatter, hash: p.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      if (typeof frontmatter.applied !== 'boolean') {
        throw new DomainError('VALIDATION', 'applied must be a boolean');
      }
      const p = await patches.updateFrontmatter({ path, applied: frontmatter.applied });
      return { path: p.path, frontmatter: p.frontmatter, hash: p.hash };
    },
    createThread(path, name) {
      return patches.createThreadForPatch(path, name ?? null);
    },
  };
}

function buildPlanAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { plan: plans, pageVersions } = deps;
  /**
   * 2.1.13 (M10 thread isolation) — every REST rendering of a plan row is an
   * EXTERNAL channel: the `path` is the caller's explicit address, and one
   * nothing resolves to is `PLAN_NOT_FOUND` (with this project's plans), never
   * the loader's generic NOT_FOUND nor a silently empty list.
   */
  const address = (path: string) => plans.assertAddressedPlan(path);
  return {
    list(query) {
      const search = typeof query.search === 'string' ? query.search : undefined;
      const applied = parseAppliedFilter(query.applied);
      /*
       * 2.1.27 (M10 `m10api00`, `list_plans` rest: direct) — this route IS the
       * `list_plans` operation's rest rendering and the `/plans` page's list.
       * The ORDER is the owning module's (M10): `created_at` ascending —
       * immutable in the plan's frontmatter (`q1txzrf0`) — ties by `path`, the
       * same `order: 'created'` the internal rendering answers with; this
       * endpoint declares none of its own. The `/plans` page arranges the rows
       * for display itself (most recently changed first, `usePlans`).
       * Maps listPlans()'s already-fetched frontmatter/hash directly — no
       * second frontmatter-indexer lookup or file_version query per row.
       */
      const rows = plans.listPlans({ search, applied, order: 'created' }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.updatedAt,
      }));
      /*
       * The M39 implicit-matrix window (`8suur17i`) — `limit` / `offset`, taken
       * AFTER the `applied` filter over the stable order above. Applied only
       * when the caller asks, as for `list_briefs`: the unpaged list is what
       * the `/plans` page has always read (the generic list carries no `total`).
       * ASSUMPTION:dev-2701 — REST list = list_plans order, window only when asked.
       */
      if (query.limit === undefined && query.offset === undefined) return rows;
      const { limit, offset } = parsePaging({
        limit: query.limit ?? String(rows.length),
        offset: query.offset,
      });
      return rows.slice(offset, offset + limit);
    },
    async get(path, read) {
      // 2.1.13 — the rest rendering of `get_plan`: an unknown path is PLAN_NOT_FOUND.
      const p = await plans.getByAddress(path, read);
      return {
        path: p.path,
        frontmatter: p.frontmatter,
        body: p.body,
        content: p.content,
        hash: p.hash,
        ...(p.truncated ? { truncated: p.truncated, truncationHint: p.truncationHint } : {}),
      };
    },
    async updateContent(path, content, expectedHash) {
      await address(path);
      await plans.updateContent({ path, content, expectedHash, changedBy: 'user' });
      const p = await plans.getByPath(path);
      return { path: p.path, frontmatter: p.frontmatter, hash: p.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      const title = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
      const applied = typeof frontmatter.applied === 'boolean' ? frontmatter.applied : undefined;
      // 2.1.13 — `mark_plan_applied`'s rest rendering: its row's codes are
      // PLAN_NOT_FOUND and INVALID_ARGUMENT, so a bad value is INVALID_ARGUMENT.
      if (frontmatter.applied !== undefined && applied === undefined) {
        throw new DomainError('INVALID_ARGUMENT', 'applied must be a boolean');
      }
      await address(path);
      /**
       * 0.2.15 — `threadId: null`, and deliberately not the plan's most recently
       * attached thread.
       *
       * This route is outside any thread's scope; there IS no author thread to
       * name. Substituting the last attach would publish a `plan:updated` whose
       * `threadId` is a guess that reads exactly like a fact, and consumers key
       * cache invalidation off `planPath` anyway.
       */
      const p = await plans.updateFrontmatter({
        path,
        patch: { title, applied },
        changedBy: 'user',
        threadId: null,
      });
      return { path: p.path, frontmatter: p.frontmatter, hash: p.hash };
    },
    // Not the client's actual creation path (see file header) — delegates to
    // the same PlanService method the bespoke POST /api/plans/:slug/create-thread
    // route uses, so there's no behavior fork if a caller does reach this route.
    createThread(path) {
      return plans.attachThreadToPlan(path);
    },
    // 2.1.13 — `list_plan_versions`' rest rendering. The order stays the REST
    // family's (newest first, what the version-history panel reads).
    async listVersions(path) {
      await address(path);
      return pageVersions.listVersions(path, plans.rootId);
    },
    // 2.1.13 — `get_plan_version`'s rest rendering: an unknown path is
    // PLAN_NOT_FOUND; a version off the plan's axis (not a positive integer, or
    // past its last version) is INVALID_ARGUMENT, as on the MCP rendering.
    async getVersion(path, rawVersion) {
      const version = Number(rawVersion);
      if (!Number.isInteger(version) || version <= 0) {
        throw new DomainError('INVALID_ARGUMENT', `version must be a positive integer, got ${JSON.stringify(rawVersion)}`);
      }
      await address(path);
      const detail = pageVersions.getVersion(path, version, plans.rootId);
      if (!detail) {
        const current = pageVersions.getLatestForPath(path, undefined, plans.rootId)?.version ?? 0;
        throw new DomainError(
          'INVALID_ARGUMENT',
          `version ${version} of plan '${path}' does not exist — the plan has ${current} version(s)`,
          current > 0 ? `pass a version from 1 to ${current}` : 'the plan has no versions yet',
        );
      }
      return detail;
    },
  };
}

/**
 * Express splat (`/*`) puts ONLY the matched wildcard portion in
 * `req.params[0]`. Literal segments (`/versions`, `:version`, etc.) are
 * stripped automatically.
 */
function extractPath(params: unknown): string {
  const splat = (params as Record<string, string>)[0];
  if (!splat) throw new DomainError('VALIDATION', 'missing artifact path');
  return splat;
}

/**
 * 2.1.48 (M36 `r2nekhf5`, L4 `Widok`) — the detail route's two projections.
 *
 * - no `view` — the EDITOR's read: the whole file, no response budget, no
 *   window, never `truncated`. The editor saves by full replacement guarded by
 *   the whole file's `expectedHash`; content cut by the budget would pass that
 *   guard and overwrite the file with its fragment.
 * - `view=operation` — the `rest` rendering of `get_<kind>`: the line window
 *   `range=<start>-<end>` (1-based, inclusive), the response budget and its
 *   explicit degradation (`truncated` + a `truncationHint` retrying with
 *   `range` under the same `view=operation`).
 *
 * Any other `view`, and a `range` without `view=operation`, is a 400
 * INVALID_ARGUMENT naming `view=operation` — never a silent fall back to the
 * default projection, which would hand a caller asking for a window the very
 * whole file it was avoiding.
 */
function parseDetailProjection(query: Record<string, unknown>): ArtifactDetailRead {
  const { view, range } = query;
  if (view === undefined) {
    if (range !== undefined) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        '?range is a parameter of the operation projection — pass it with ?view=operation',
        'e.g. ?view=operation&range=1-400',
      );
    }
    return { full: true };
  }
  if (view !== 'operation') {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `unknown ?view ${JSON.stringify(view)} — the only view of this route is view=operation (omit it for the whole file)`,
      'e.g. ?view=operation&range=1-400',
    );
  }
  return { range: parseRangeQuery(range), channel: 'rest' };
}

/**
 * `range=<start>-<end>` — the artifact read family's line window. Rejected
 * loudly rather than ignored: a window silently dropped would answer with the
 * whole file, and a caller asking for a window because the file is too big
 * would get exactly the response it was trying to avoid.
 */
function parseRangeQuery(raw: unknown): ArtifactRange | undefined {
  if (raw === undefined) return undefined;
  const m = typeof raw === 'string' ? /^(\d+)-(\d+)$/.exec(raw) : null;
  if (!m) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `?range must be '<start>-<end>' (1-based, inclusive), got ${JSON.stringify(raw)}`,
      'e.g. ?view=operation&range=1-400',
    );
  }
  return { start: Number(m[1]), end: Number(m[2]) };
}

/** `?limit`/`?offset` with the family's defaults; anything non-numeric is a 400. */
function parsePaging(query: Record<string, unknown>): { limit: number; offset: number } {
  const read = (raw: unknown, name: string, fallback: number): number => {
    // `?limit=` with no value must not become `Number('') === 0`, which would
    // silently return an empty page instead of the default one.
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw new DomainError('VALIDATION', `${name} must be a non-negative integer`);
    }
    return n;
  };
  return { limit: read(query.limit, 'limit', 20), offset: read(query.offset, 'offset', 0) };
}

export function artifactsRouter(deps: ArtifactsRouterDeps): Router {
  const adapters: Record<ArtifactKind, ArtifactKindAdapter> = {
    brief: buildBriefAdapter(deps),
    patch: buildPatchAdapter(deps),
    plan: buildPlanAdapter(deps),
  };

  const router = Router();

  /**
   * The whole of thread listing, for every kind: resolve the registry's
   * `binding.threadColumn` and hand it to the one `chat_thread` query. No
   * per-kind branch, no per-service projection.
   */
  const listThreads = (
    kind: ArtifactKind,
    path: string,
    paging: { limit: number; offset: number } = { limit: 20, offset: 0 },
  ): ArtifactThreadListItem[] =>
    deps.chat.listThreadsByArtifact({
      threadColumn: artifactEntry(kind).binding.threadColumn as ArtifactThreadColumn,
      path,
      ...paging,
    });

  router.param('kind', (req, res, next, kind) => {
    if (!(kind in adapters)) {
      return next(new DomainError('UNKNOWN_ARTIFACT_KIND', `unknown artifact kind '${kind}'`));
    }
    next();
  });

  // GET /api/artifacts/:kind — list (per-kind query filters: ?implemented= for
  // brief, ?brief=/?status= for patch).
  router.get('/:kind', (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      res.json({ data: adapters[kind].list(req.query as Record<string, unknown>) });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path>/versions
  router.get('/:kind/*/versions', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const adapter = adapters[kind];
      const versions = adapter.listVersions
        ? await adapter.listVersions(path)
        : deps.pageVersions.listVersions(path, artifactRootId(kind));
      res.json({ data: versions });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path>/versions/:version
  router.get('/:kind/*/versions/:version', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const adapter = adapters[kind];
      if (adapter.getVersion) {
        res.json({ data: await adapter.getVersion(extractPath(req.params), String(req.params.version)) });
        return;
      }
      const version = Number(req.params.version);
      if (!Number.isInteger(version) || version <= 0) {
        throw new DomainError('VALIDATION', 'version must be a positive integer');
      }
      const path = extractPath(req.params);
      const detail = deps.pageVersions.getVersion(path, version, artifactRootId(kind));
      if (!detail) throw new DomainError('VERSION_NOT_FOUND', `version ${version} not found`);
      res.json({ data: detail });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/artifacts/:kind/<path>/content — full replace, optimistic concurrency.
  router.put('/:kind/*/content', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const body = (req.body ?? {}) as { content?: string; expectedHash?: string };
      if (typeof body.content !== 'string') {
        throw new DomainError('VALIDATION', 'content is required');
      }
      if (typeof body.expectedHash !== 'string') {
        throw new DomainError('VALIDATION', 'expectedHash is required for content updates');
      }
      const out = await adapters[kind].updateContent(path, body.content, body.expectedHash);
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/artifacts/:kind/<path>/frontmatter — only the mutable fields of
  // the root kind's header contract are accepted; anything else -> 400 IMMUTABLE_FIELD.
  // 2.1.57 (M36 `m36l4fam`): no `expectedHash` — each kind's service merges the
  // sent keys into the file it reads under its per-path lock, so a concurrent
  // content save or second frontmatter write is never lost.
  // ASSUMPTION:dev-0003 request/response DTO binding kept (ArtifactFrontmatterUpdateRequest in);
  // ASSUMPTION:dev-0005 the answer stays echo-free `{ path, frontmatter, hash }` (ArtifactWriteResponse).
  router.patch('/:kind/*/frontmatter', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const body = (req.body ?? {}) as Partial<ArtifactFrontmatterUpdateRequest>;
      const frontmatter = body.frontmatter ?? {};
      // 2.1.8: the mutable fields come from the root kind's header contract.
      const mutable = new Set(artifactHeaderContract(kind).mutable);
      const invalid = Object.keys(frontmatter).filter((k) => !mutable.has(k));
      if (invalid.length > 0) {
        throw new DomainError(
          'IMMUTABLE_FIELD',
          `cannot mutate immutable frontmatter keys: ${invalid.join(', ')} (mutable: ${[...mutable].join(', ')})`,
        );
      }
      const out = await adapters[kind].updateFrontmatter(path, frontmatter);
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path>/threads — 0.1.139: the generic listing of
  // every top-level thread referencing this artifact (transagent bankas, which
  // carry a parent_thread_id, are excluded), newest activity first.
  router.get('/:kind/*/threads', (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const paging = parsePaging(req.query as Record<string, unknown>);
      res.json({ data: listThreads(kind, path, paging) });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/artifacts/:kind/<path>/threads
  router.post('/:kind/*/threads', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const body = (req.body ?? {}) as { name?: string };
      const result = await adapters[kind].createThread(path, body.name ?? null);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path>[?view=operation[&range=a-b]] — detail, in
  // two projections (2.1.48, see parseDetailProjection). Must be LAST so the
  // more specific /versions, /content, /frontmatter, /threads routes match first.
  router.get('/:kind/*', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      // 0.1.139: `threads` is NOT merged in here any more. The pre-M36 detail
      // routes carried it because the detail pages read `.threads` off this
      // call; they now all use `GET .../threads` (which pages properly), so
      // merging it meant a second chat_thread scan per detail fetch whose
      // result nothing read — and one silently capped at the default limit.
      res.json({ data: await adapters[kind].get(path, parseDetailProjection(req.query as Record<string, unknown>)) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
