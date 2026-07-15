/**
 * M23 PatchService — thin wrapper over the third `PagesService` instance
 * mounted on `patchesDir`. Patches are markdown files with mandatory YAML
 * frontmatter (`type: patch`, `brief`, `patch_kind`, `created_at`,
 * `created_by`, `status`). They are authored by coding agents in *other*
 * terminals during brief implementation — claude4spec only reads them, lets
 * the spec author flip `status`, and spins up a chat thread to fold the
 * patch's findings back into the spec.
 *
 * Design notes (parallel to BriefService):
 *   - **Zero new tables**. Listing comes from PagesFrontmatterIndexer.
 *   - **Optimistic concurrency** by sha256 hash of full content.
 *   - **Immutable frontmatter** keys protected (PATCH_IMMUTABLE_FRONTMATTER_KEYS);
 *     only `status` is mutable from the claude4spec side.
 *   - A patch links to a brief via the `brief` frontmatter field, or — when
 *     absent — by filename prefix. Unresolvable ⇒ orphan (`briefPath: null`).
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type {
  BriefThreadSummary,
  PatchFrontmatter,
  PatchKind,
  PatchListItem,
  PatchResponse,
  PatchStatus,
} from '../../shared/entities.js';
import { PATCH_IMMUTABLE_FRONTMATTER_KEYS } from '../../shared/entities.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER } from '../../shared/types.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { FileVersionService } from './file-version.js';
import type { FileSerializer } from './file-serializer.js';
import type { ChatService } from './chat.js';
import type { PagesFrontmatterIndexer } from './pages-frontmatter-indexer.js';
import { DomainError } from './tags.js';
import { ConflictError } from './brief.js';

export interface PatchServiceDeps {
  patchesPages: PagesService;
  patchesWatcher: PagesWatcher;
  patchesSerializer: FileSerializer;
  pageVersions: FileVersionService;
  chatService: ChatService;
  frontmatterIndexer: PagesFrontmatterIndexer;
}

export interface PatchListOpts {
  /** Filter to a single brief (its briefsDir-relative path). */
  brief?: string;
  status?: PatchStatus;
}

export interface PatchUpdateContentOpts {
  path: string;
  content: string;
  expectedHash?: string;
}

export interface PatchUpdateFrontmatterOpts {
  path: string;
  status: PatchStatus;
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

  async getPatch(relPath: string): Promise<PatchResponse> {
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
    return {
      path: relPath,
      title: extractTitle(parsed.content, frontmatter, relPath),
      frontmatter,
      body: parsed.content,
      content,
      hash: hashContent(content),
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
      const status: PatchStatus = fm.status === 'completed' ? 'completed' : 'awaiting';
      const briefPath = this.resolveBriefPath(rec.path, fm, briefPaths);
      if (opts.brief !== undefined && opts.brief !== briefPath) continue;
      if (opts.status !== undefined && opts.status !== status) continue;
      const lastVersion = this.deps.pageVersions.getLatestForPath(rec.path, undefined, 'patch');
      const createdAt = toIso(fm.created_at);
      out.push({
        path: rec.path,
        title: extractTitleFromFrontmatter(fm, rec.path),
        briefPath,
        patchKind: normalizeKind(fm.patch_kind),
        status,
        createdAt,
        createdBy: String(fm.created_by ?? ''),
        lastModified: lastVersion?.createdAt ?? createdAt,
        threadCount: this.deps.chatService.threadCountForPatch(rec.path),
      });
    }
    return out;
  }

  listThreadsForPatch(relPath: string): BriefThreadSummary[] {
    return this.deps.chatService.listThreadsForPatch(relPath).map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      messageCount: t.messageCount,
    }));
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  async updateContent(opts: PatchUpdateContentOpts): Promise<PatchResponse> {
    const current = await this.getPatch(opts.path);
    if (typeof opts.expectedHash === 'string' && opts.expectedHash !== current.hash) {
      throw new ConflictError('PATCH_CONFLICT', 'patch changed since last read', current.hash);
    }
    const incoming = matter(opts.content);
    const incomingFm = (incoming.data ?? {}) as PatchFrontmatter;
    const violated: string[] = PATCH_IMMUTABLE_FRONTMATTER_KEYS.filter(
      (k) => JSON.stringify(incomingFm[k]) !== JSON.stringify(current.frontmatter[k]),
    );
    if (violated.length > 0) {
      throw new DomainError(
        'PATCH_FRONTMATTER_IMMUTABLE',
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

  async updateFrontmatter(opts: PatchUpdateFrontmatterOpts): Promise<PatchResponse> {
    const current = await this.getPatch(opts.path);
    const next: PatchFrontmatter = { ...current.frontmatter, status: opts.status };
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
      `set status=${opts.status}`,
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

/**
 * YAML auto-parses ISO timestamps into JS `Date` objects — normalize back to
 * an ISO 8601 string for DTO fields (`PatchListItem.createdAt`).
 */
function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v == null ? '' : String(v);
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

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}
