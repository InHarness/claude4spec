import { Router } from 'express';
import type { BriefService } from '../services/brief.js';
import type { PatchService } from '../services/patch.js';
import type { PlanService } from '../services/plan.js';
import type { FileVersionService } from '../services/file-version.js';
import type { ChatService, ArtifactThreadColumn } from '../services/chat.js';
import { artifactRegistry, type ArtifactKind } from '../services/artifact-registry.js';
import type {
  ArtifactListItem,
  ArtifactResponse,
  ArtifactThreadListItem,
  PatchStatus,
} from '../../shared/entities.js';
import { DomainError } from '../services/tags.js';

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
  get(path: string): Promise<ArtifactResponse>;
  updateContent(path: string, content: string, expectedHash: string): Promise<ArtifactResponse>;
  updateFrontmatter(path: string, frontmatter: Record<string, unknown>): Promise<ArtifactResponse>;
  createThread(path: string, name?: string | null): Promise<{ threadId: string }>;
}

export interface ArtifactsRouterDeps {
  brief: BriefService;
  patch: PatchService;
  plan: PlanService;
  pageVersions: FileVersionService;
  chat: ChatService;
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
      return briefs.listBriefs({ implemented }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.lastModifiedAt,
      }));
    },
    async get(path) {
      const b = await briefs.getBrief(path);
      return { path: b.path, frontmatter: b.frontmatter, body: b.body, content: b.content, hash: b.hash };
    },
    async updateContent(path, content, expectedHash) {
      await briefs.updateContent({ path, content, expectedHash, changedBy: 'user' });
      const b = await briefs.getBrief(path);
      return { path: b.path, frontmatter: b.frontmatter, body: b.body, content: b.content, hash: b.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      const implemented =
        typeof frontmatter.implemented === 'boolean' ? frontmatter.implemented : undefined;
      const b = await briefs.updateFrontmatter({ path, patch: { implemented }, changedBy: 'user' });
      return { path: b.path, frontmatter: b.frontmatter, body: b.body, content: b.content, hash: b.hash };
    },
    createThread(path, name) {
      return Promise.resolve(briefs.createThreadForBrief({ path, name: name ?? null }));
    },
  };
}

function buildPatchAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { patch: patches } = deps;
  return {
    list(query) {
      const brief = typeof query.brief === 'string' ? query.brief : undefined;
      let status: PatchStatus | undefined;
      if (query.status === undefined) {
        status = undefined;
      } else if (query.status === 'awaiting' || query.status === 'completed') {
        status = query.status;
      } else {
        throw new DomainError('VALIDATION', `?status must be 'awaiting' or 'completed' (omit for all)`);
      }
      // Maps listPatches()'s already-fetched frontmatter/hash directly — no
      // second frontmatter-indexer lookup or file_version query per row.
      return patches.listPatches({ brief, status }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.lastModified,
      }));
    },
    async get(path) {
      const p = await patches.getPatch(path);
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateContent(path, content, expectedHash) {
      const p = await patches.updateContent({ path, content, expectedHash });
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      if (frontmatter.status !== 'awaiting' && frontmatter.status !== 'completed') {
        throw new DomainError('VALIDATION', "status must be 'awaiting' or 'completed'");
      }
      const p = await patches.updateFrontmatter({ path, status: frontmatter.status });
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    createThread(path, name) {
      return patches.createThreadForPatch(path, name ?? null);
    },
  };
}

function buildPlanAdapter(deps: ArtifactsRouterDeps): ArtifactKindAdapter {
  const { plan: plans } = deps;
  return {
    list(query) {
      const search = typeof query.search === 'string' ? query.search : undefined;
      // Maps listPlans()'s already-fetched frontmatter/hash directly — no
      // second frontmatter-indexer lookup or file_version query per row.
      return plans.listPlans({ search }).map((item) => ({
        path: item.path,
        frontmatter: item.frontmatter,
        hash: item.hash,
        updatedAt: item.updatedAt,
      }));
    },
    async get(path) {
      const p = await plans.getByPath(path);
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateContent(path, content, expectedHash) {
      await plans.updateContent({ path, content, expectedHash, changedBy: 'user' });
      const p = await plans.getByPath(path);
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    async updateFrontmatter(path, frontmatter) {
      const title = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
      const p = await plans.updateFrontmatter({ path, patch: { title }, changedBy: 'user' });
      return { path: p.path, frontmatter: p.frontmatter, body: p.body, content: p.content, hash: p.hash };
    },
    // Not the client's actual creation path (see file header) — delegates to
    // the same PlanService method the bespoke POST /api/plans/:slug/create-thread
    // route uses, so there's no behavior fork if a caller does reach this route.
    createThread(path) {
      return plans.attachThreadToPlan(path);
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
      threadColumn: artifactRegistry[kind].binding.threadColumn as ArtifactThreadColumn,
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
  router.get('/:kind/*/versions', (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const versions = deps.pageVersions.listVersions(path, artifactRegistry[kind].rootId);
      res.json({ data: versions });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/artifacts/:kind/<path>/versions/:version
  router.get('/:kind/*/versions/:version', (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const version = Number(req.params.version);
      if (!Number.isInteger(version) || version <= 0) {
        throw new DomainError('VALIDATION', 'version must be a positive integer');
      }
      const path = extractPath(req.params);
      const detail = deps.pageVersions.getVersion(path, version, artifactRegistry[kind].rootId);
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

  // PATCH /api/artifacts/:kind/<path>/frontmatter — only keys in the kind's
  // frontmatterContract.mutable are accepted; anything else -> 400 IMMUTABLE_FIELD.
  router.patch('/:kind/*/frontmatter', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const body = (req.body ?? {}) as { frontmatter?: Record<string, unknown> };
      const frontmatter = body.frontmatter ?? {};
      const mutable = new Set(artifactRegistry[kind].frontmatterContract.mutable);
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

  // GET /api/artifacts/:kind/<path> — detail (must be LAST so the more
  // specific /versions, /content, /frontmatter, /threads routes match first).
  router.get('/:kind/*', async (req, res, next) => {
    try {
      const kind = req.params.kind as ArtifactKind;
      const path = extractPath(req.params);
      const data = await adapters[kind].get(path);
      // Kept from the pre-M36 per-kind detail routes: client detail pages read
      // `.threads` off this same call. The dedicated GET .../threads above is
      // what a panel refetching on its own uses.
      res.json({ data: { ...data, threads: listThreads(kind, path) } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
