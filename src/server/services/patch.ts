/**
 * M23 PatchService — thin wrapper over the third `PagesService` instance
 * mounted on `patchesDir`. Patches are markdown files with mandatory YAML
 * frontmatter (`type: patch`, `brief`, `patch_kind`, `created_at`,
 * `created_by`, `applied`). They are authored by coding agents in *other*
 * terminals during brief implementation — claude4spec only reads them, lets
 * the spec author flip `applied`, and spins up a chat thread to fold the
 * patch's findings back into the spec.
 *
 * Design notes (parallel to BriefService):
 *   - **Zero new tables**. Listing comes from PagesFrontmatterIndexer.
 *   - **Optimistic concurrency** by sha256 hash of full content.
 *   - **Immutable frontmatter** keys protected (PATCH_IMMUTABLE_FRONTMATTER_KEYS);
 *     only `applied` is mutable from the claude4spec side (0.2.14 — it
 *     replaced the `status: awaiting | completed` enum with the same boolean
 *     the plan carries).
 *   - A patch links to a brief via the `brief` frontmatter field, or — when
 *     absent — by filename prefix. Unresolvable ⇒ orphan (`briefPath: null`).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { PatchFrontmatter, PatchKind } from '../../shared/entities.js';
import { PATCH_IMMUTABLE_FRONTMATTER_KEYS } from '../../shared/entities.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER } from '../../shared/types.js';
import type { PagesService } from './pages.js';
import type { SelfWriteMarker } from '../fs/sources.js';
import type { FileVersionService } from './file-version.js';
import { hashContent, toIso } from './artifact-content.js';
import type { FileSerializer } from './file-serializer.js';
import type { ChatService } from './chat.js';
import type { PagesFrontmatterIndexer } from './pages-frontmatter-indexer.js';
import { DomainError } from './tags.js';
import { readArtifactWindow, windowBody, type ArtifactRange } from './artifact-read.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import { ConflictError } from './brief.js';

export interface PatchServiceDeps {
  patchesPages: PagesService;
  patchesWatcher: SelfWriteMarker;
  patchesSerializer: FileSerializer;
  pageVersions: FileVersionService;
  chatService: ChatService;
  frontmatterIndexer: PagesFrontmatterIndexer;
}

export interface PatchListOpts {
  /** Filter to a single brief (its briefsDir-relative path). */
  brief?: string;
  /** 0.2.14: narrow to applied (`true`) or pending (`false`). Omit for all. */
  applied?: boolean;
  /**
   * v0.1.129 fix: `threadCount` costs one extra `chatService` query per row —
   * the generic `/api/artifacts/patch` REST route never reads it off
   * `PatchListItem` (the wire `ArtifactListItem` doesn't carry the field at
   * all), so that query used to run on every list call regardless. Default
   * `false` skips it; pass `true` for a caller that actually needs the count.
   */
  includeThreadInfo?: boolean;
}

export interface PatchUpdateContentOpts {
  path: string;
  content: string;
  expectedHash?: string;
}

export interface PatchUpdateFrontmatterOpts {
  path: string;
  applied: boolean;
}

/**
 * Internal detail shape for `getPatch()`/`updateContent()`/`updateFrontmatter()`.
 * Was previously the shared `PatchResponse` DTO; M36 replaced the wire-level
 * detail shape with the generic `ArtifactResponse` (no top-level `title` — the
 * client derives it from the body's first heading), so this stays a
 * service-internal type that `routes/artifacts.ts`'s patch adapter maps to
 * `ArtifactResponse` at the REST boundary.
 */
export interface PatchDetail {
  /** Path relative to patchesDir. */
  path: string;
  title: string;
  frontmatter: PatchFrontmatter;
  body: string;
  /** Full file content (frontmatter + body, byte-faithful). */
  content: string;
  /** sha256 hex of the WHOLE file — used for optimistic concurrency, unaffected by `range`. */
  hash: string;
  /**
   * 0.2.40 — present IFF `content` was cut by the response budget (the artifact
   * read family's shared marker). `truncationHint` always points at `range`.
   */
  truncated?: true;
  truncationHint?: string;
}

/**
 * Internal list-item shape for `listPatches()`. Was previously the shared
 * `PatchListItem` DTO — see `PatchDetail`'s doc comment for why this moved.
 */
export interface PatchListItem {
  path: string;
  title: string;
  /** `null` = orphan (no resolvable brief). */
  briefPath: string | null;
  patchKind: PatchKind;
  applied: boolean;
  createdAt: string;
  createdBy: string;
  /** `created_at` of the latest file_version row with kind='patch'. */
  lastModified: string;
  /** Count of chat threads with context_type='patch' pointing at this patch. */
  threadCount: number;
  /** Raw parsed frontmatter — lets routes/artifacts.ts build `ArtifactListItem`
   *  without a second frontmatter-indexer lookup for the same record. */
  frontmatter: PatchFrontmatter;
  /** sha256 of the latest captured version's content — reuses the version
   *  lookup this method already does for `lastModified`, instead of the
   *  router re-querying `file_version` and re-hashing per row. */
  hash: string;
}

const VALID_PATCH_KINDS: ReadonlySet<string> = new Set([
  'drift',
  'missing',
  'incorrect',
  'clarification',
]);

export class PatchService {
  constructor(private deps: PatchServiceDeps) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * 0.2.40 — the artifact read family's window: `range` is a 1-based inclusive
   * line window, unconditionally allowed (no `sectionIndexed` gate — a patch never
   * enters `section_index`), and a `start` past the end of the file is
   * `INVALID_ARGUMENT` STATING the size. The mechanism is shared with brief and
   * plan in `artifact-read.ts`; this kind declares a value for it, it does not
   * implement a variant of it.
   *
   * `hash` stays the digest of the whole file — see `readArtifactWindow`.
   */
  async getPatch(relPath: string, opts?: { range?: ArtifactRange }): Promise<PatchDetail> {
    if (!(await this.deps.patchesPages.exists(relPath))) {
      throw new DomainError('NOT_FOUND', `patch '${relPath}' not found`);
    }
    const abs = this.absPath(relPath);
    const content = await fs.readFile(abs, 'utf-8');
    const parsed = matter(content);
    const frontmatter = (parsed.data ?? {}) as PatchFrontmatter;
    if (frontmatter.type !== 'patch') {
      throw new DomainError(
        'PATCH_INVALID_FRONTMATTER',
        `file '${relPath}' is not a patch (frontmatter.type=${JSON.stringify(frontmatter.type)})`,
      );
    }
    const hash = hashContent(content);
    const windowed = readArtifactWindow(
      content,
      opts?.range,
      { kind: 'patch', path: relPath },
      Math.floor(DEFAULT_BUDGET_CHARS / 2),
    );
    const body =
      windowed.content === content
        ? parsed.content
        : windowBody(content, windowed.content, opts?.range?.start ?? 1);
    return {
      path: relPath,
      title: extractTitle(parsed.content, frontmatter, relPath),
      frontmatter,
      body,
      content: windowed.content,
      hash,
      ...(windowed.truncated
        ? { truncated: windowed.truncated, truncationHint: windowed.truncationHint }
        : {}),
    };
  }

  listPatches(opts: PatchListOpts = {}): PatchListItem[] {
    const briefPaths = this.knownBriefPaths();
    const records = this.deps.frontmatterIndexer.findByFrontmatterType('patch', {
      rootId: PATCH_ROOT_MARKER,
    });
    const out: PatchListItem[] = [];
    for (const rec of records) {
      const fm = rec.frontmatter as PatchFrontmatter;
      // 0.2.14: a legacy `status` key is an unknown field — even
      // `status: completed` reads as `applied: false`. Files are not migrated.
      const applied = fm.applied === true;
      const briefPath = this.resolveBriefPath(rec.path, fm, briefPaths);
      if (opts.brief !== undefined && opts.brief !== briefPath) continue;
      if (opts.applied !== undefined && opts.applied !== applied) continue;
      const lastVersion = this.deps.pageVersions.getLatestForPath(rec.path, undefined, 'patch');
      const createdAt = toIso(fm.created_at);
      out.push({
        path: rec.path,
        title: extractTitleFromFrontmatter(fm, rec.path),
        briefPath,
        patchKind: normalizeKind(fm.patch_kind),
        applied,
        createdAt,
        createdBy: String(fm.created_by ?? ''),
        lastModified: lastVersion?.createdAt ?? createdAt,
        threadCount: opts.includeThreadInfo ? this.deps.chatService.threadCountForPatch(rec.path) : 0,
        frontmatter: fm,
        hash: lastVersion ? hashContent(lastVersion.data.content) : '',
      });
    }
    return out;
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  async updateContent(opts: PatchUpdateContentOpts): Promise<PatchDetail> {
    const current = await this.getPatch(opts.path);
    if (typeof opts.expectedHash === 'string' && opts.expectedHash !== current.hash) {
      throw new ConflictError('PATCH_CONFLICT', 'patch changed since last read', current.hash, current.content);
    }
    const incoming = matter(opts.content);
    const incomingFm = (incoming.data ?? {}) as PatchFrontmatter;
    const violated: string[] = PATCH_IMMUTABLE_FRONTMATTER_KEYS.filter(
      (k) => JSON.stringify(incomingFm[k]) !== JSON.stringify(current.frontmatter[k]),
    );
    if (violated.length > 0) {
      throw new DomainError(
        'IMMUTABLE_FIELD',
        `cannot mutate immutable frontmatter keys: ${violated.join(', ')}`,
      );
    }
    const abs = this.absPath(opts.path);
    this.deps.patchesWatcher.suppress(opts.path);
    await fs.writeFile(abs, opts.content, 'utf-8');
    await this.deps.pageVersions.recordVersion(
      opts.path,
      'update',
      'user',
      undefined,
      this.deps.patchesSerializer,
      'patch',
    );
    await this.deps.frontmatterIndexer.indexPage(PATCH_ROOT_MARKER, opts.path);
    return this.getPatch(opts.path);
  }

  async updateFrontmatter(opts: PatchUpdateFrontmatterOpts): Promise<PatchDetail> {
    const current = await this.getPatch(opts.path);
    // Spread-then-set: a legacy `status` key already in the file survives the
    // write untouched (gray-matter pass-through), it is simply never read.
    const next: PatchFrontmatter = { ...current.frontmatter, applied: opts.applied };
    const newContent = matter.stringify(current.body, next as Record<string, unknown>);
    const abs = this.absPath(opts.path);
    this.deps.patchesWatcher.suppress(opts.path);
    await fs.writeFile(abs, newContent, 'utf-8');
    await this.deps.pageVersions.recordVersion(
      opts.path,
      'update',
      'user',
      undefined,
      this.deps.patchesSerializer,
      'patch',
      `set applied=${opts.applied}`,
    );
    await this.deps.frontmatterIndexer.indexPage(PATCH_ROOT_MARKER, opts.path);
    return this.getPatch(opts.path);
  }

  async createThreadForPatch(
    relPath: string,
    name?: string | null,
  ): Promise<{ threadId: string }> {
    if (!(await this.deps.patchesPages.exists(relPath))) {
      throw new DomainError('NOT_FOUND', `patch '${relPath}' not found`);
    }
    const thread = this.deps.chatService.createThread(name ?? `Patch: ${relPath}`, {
      contextType: 'patch',
      patchPath: relPath,
    });
    return { threadId: thread.id };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private absPath(relPath: string): string {
    return path.join(this.deps.patchesPages.root, relPath);
  }

  private knownBriefPaths(): string[] {
    return this.deps.frontmatterIndexer
      .findByFrontmatterType('brief', { rootId: BRIEF_ROOT_MARKER })
      .map((r) => r.path);
  }

  /**
   * Resolve the brief a patch belongs to: the `brief` frontmatter field if it
   * names an existing brief, else the brief whose filename stem is the longest
   * prefix of the patch filename stem, else `null` (orphan).
   */
  private resolveBriefPath(
    patchPath: string,
    fm: PatchFrontmatter,
    briefPaths: string[],
  ): string | null {
    if (typeof fm.brief === 'string' && fm.brief.length > 0) {
      const declared = fm.brief;
      if (briefPaths.includes(declared)) return declared;
    }
    const patchStem = stem(patchPath);
    let best: string | null = null;
    for (const bp of briefPaths) {
      const briefStem = stem(bp);
      if (patchStem === briefStem || patchStem.startsWith(briefStem + '-')) {
        if (best === null || stem(bp).length > stem(best).length) best = bp;
      }
    }
    return best;
  }
}

function stem(p: string): string {
  return path.basename(p).replace(/\.md$/i, '');
}

function normalizeKind(raw: unknown): PatchKind {
  return VALID_PATCH_KINDS.has(String(raw)) ? (raw as PatchKind) : 'clarification';
}

function extractTitle(body: string, fm: PatchFrontmatter, relPath: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1 && h1[1]) return h1[1].trim();
  return extractTitleFromFrontmatter(fm, relPath);
}

function extractTitleFromFrontmatter(fm: PatchFrontmatter, relPath: string): string {
  if (typeof fm.title === 'string' && fm.title.length > 0) return fm.title;
  return stem(relPath);
}
