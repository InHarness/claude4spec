/**
 * M21 BriefService — thin wrapper over the second `PagesService` instance
 * mounted on `briefsDir`. Briefs are markdown files with mandatory YAML
 * frontmatter (`type: brief`, `from_release`, `to_release`, ...). The file
 * itself is the source of truth (consumed both by humans in UI and by coding
 * agents in terminal). DB participation is limited to:
 *   - `chat_thread.brief_path` (M05) for editorial threads
 *   - `file_version` (M17 Phase 4) — automatic via shared FileVersionService
 *
 * Design notes:
 *   - **Zero new tables**. Listing comes from PagesFrontmatterIndexer.
 *   - **Optimistic concurrency** by sha256 hash of full content (frontmatter+body).
 *   - **Immutable frontmatter** keys protected: type/from_release/to_release/
 *     generated_at/generator_version. Mutation attempt → DomainError.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type {
  Brief,
  BriefChangedBy,
  BriefFrontmatter,
  BriefSource,
  BriefThreadSummary,
} from '../../shared/entities.js';
import { BRIEF_IMMUTABLE_FRONTMATTER_KEYS } from '../../shared/entities.js';
import { BRIEF_ROOT_MARKER } from '../../shared/types.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { FileVersionService } from './file-version.js';
import type { FileSerializer } from './file-serializer.js';
import type { ChatService } from './chat.js';
import type { ReleaseService } from './release.js';
import type { PagesFrontmatterIndexer } from './pages-frontmatter-indexer.js';
import { DomainError } from './tags.js';

const GENERATOR_VERSION = 'brief-author@0.1';

export interface BriefServiceDeps {
  briefsPages: PagesService;
  briefsWatcher: PagesWatcher;
  briefsSerializer: FileSerializer;
  pageVersions: FileVersionService;
  chatService: ChatService;
  releaseService: ReleaseService;
  frontmatterIndexer: PagesFrontmatterIndexer;
  ws: WsEmitter;
}

export interface BriefCreateOpts {
  /** 0.1.69: brief provenance. Defaults to 'release-diff' when absent. */
  source?: BriefSource;
  /** `null` = initial brief — pomijamy walidacje `fromRelease` i frontmatter trzyma `from_release: null`. */
  fromReleaseName: string | null;
  /** `null` = analysis brief (state relative to HEAD; no target release). */
  toReleaseName: string | null;
  /**
   * 0.1.69: pre-synthesized brief body (analysis briefs synthesize it from the
   * parent thread's `message`). Absent ⇒ the generated stub body is used.
   */
  content?: string;
  suffix?: string;
  /**
   * 0.1.96: brief scope — releasable root ids this brief covers. Written verbatim
   * to immutable `roots` frontmatter and added as a slug segment. Omitted or empty
   * ⇒ whole-release scope (all releasable roots) — no `roots` frontmatter key and
   * no slug segment.
   */
  roots?: string[];
}

/** 0.1.69: extended createThreadForBrief signature — supports child banki. */
export interface BriefThreadForBriefOpts {
  path: string;
  name?: string | null;
  /** 0.1.69 Transagents: mark the created thread as a hidden child banka. */
  parentThreadId?: string | null;
  spawnedByToolUseId?: string | null;
}

export interface BriefUpdateContentOpts {
  path: string;
  content: string;
  expectedHash?: string;
  changedBy: BriefChangedBy;
  changeSummary?: string;
}

export interface BriefUpdateFrontmatterOpts {
  path: string;
  patch: { implemented?: boolean };
  changedBy: BriefChangedBy;
}

export interface BriefListOpts {
  implemented?: boolean;
}

/**
 * Internal list-item shape for `BriefService.listBriefs()`. Was previously the
 * shared `BriefListItem` DTO; M36 replaced the wire-level list shape with the
 * generic `ArtifactListItem` (no top-level title/source/threadCount — those
 * live in `frontmatter` or are dropped), so this stays a service-internal type
 * that `routes/artifacts.ts`'s brief adapter maps to `ArtifactListItem` at the
 * REST boundary.
 */
export interface BriefListItem {
  path: string;
  title: string | null;
  /** 0.1.69: brief provenance ('release-diff' | 'analysis'). */
  source: string;
  /** `null` = initial brief. */
  fromRelease: string | null;
  /** `null` = analysis brief (no target release; state relative to HEAD). */
  toRelease: string | null;
  implemented: boolean;
  generatedAt: string;
  lastModifiedAt: string | null;
  /** 0.1.69 B4: count of top-level (non-banka) brief threads for this brief. */
  threadCount: number;
  /** Raw parsed frontmatter — lets routes/artifacts.ts build `ArtifactListItem`
   *  without a second frontmatter-indexer lookup for the same record. */
  frontmatter: BriefFrontmatter;
  /** sha256 of the latest captured version's content — reuses the version
   *  lookup this method already does for `lastModifiedAt`, instead of the
   *  router re-querying `file_version` and re-hashing per row. */
  hash: string;
}

export class BriefService {
  constructor(private deps: BriefServiceDeps) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  async getBrief(path: string): Promise<Brief> {
    if (!(await this.deps.briefsPages.exists(path))) {
      throw new DomainError('NOT_FOUND', `brief '${path}' not found`);
    }
    const abs = this.absPath(path);
    const content = await fs.readFile(abs, 'utf-8');
    const parsed = matter(content);
    const frontmatter = (parsed.data ?? {}) as BriefFrontmatter;
    if (frontmatter.type !== 'brief') {
      throw new DomainError(
        'BRIEF_INVALID_FRONTMATTER',
        `file '${path}' is not a brief (frontmatter.type=${JSON.stringify(frontmatter.type)})`,
      );
    }
    // 0.1.69: legacy briefs predate `source` — default to 'release-diff' at parse
    // time so the field is always present downstream (DTO, immutability diffing).
    if (frontmatter.source !== 'analysis') frontmatter.source = 'release-diff';
    return {
      path,
      frontmatter,
      body: parsed.content,
      content,
      hash: hashContent(content),
    };
  }

  listBriefs(opts: BriefListOpts = {}): BriefListItem[] {
    const records = this.deps.frontmatterIndexer.findByFrontmatterType('brief', { rootId: BRIEF_ROOT_MARKER });
    const out: BriefListItem[] = [];
    for (const rec of records) {
      const fm = rec.frontmatter as BriefFrontmatter;
      const implemented = fm.implemented === true;
      if (opts.implemented !== undefined && opts.implemented !== implemented) continue;
      const lastVersion = this.deps.pageVersions.getLatestForPath(rec.path);
      out.push({
        path: rec.path,
        title: typeof fm.title === 'string' ? (fm.title as string) : null,
        // 0.1.69: legacy briefs predate `source` — default to 'release-diff'.
        source: fm.source === 'analysis' ? 'analysis' : 'release-diff',
        fromRelease: typeof fm.from_release === 'string' ? fm.from_release : null,
        // 0.1.69: analysis briefs carry `to_release: null` → toRelease stays null.
        toRelease: typeof fm.to_release === 'string' ? fm.to_release : null,
        implemented,
        generatedAt: String(fm.generated_at ?? ''),
        lastModifiedAt: lastVersion?.createdAt ?? null,
        threadCount: this.deps.chatService.threadCountForBrief(rec.path),
        frontmatter: fm,
        hash: lastVersion ? hashContent(lastVersion.data.content) : '',
      });
    }
    return out;
  }

  listThreadsForBrief(path: string): BriefThreadSummary[] {
    return this.deps.chatService.listThreadsForBrief(path).map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      messageCount: t.messageCount,
    }));
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /**
   * 0.1.69: file-only brief creation (writes file + file_version + index, NO
   * thread). Callers pair this with {@link createThreadForBrief}. `content`
   * carries a pre-synthesized body for analysis briefs; else a generated stub.
   *
   * Validation matrix (source, from, to):
   *   - (release-diff, null, set) → initial brief
   *   - (release-diff, set,  set) → release-diff brief
   *   - (analysis,     set,  null) → analysis brief (state relative to HEAD)
   *   - (*, null, null) → 400 VALIDATION
   *   - (release-diff, *, null) → 400 VALIDATION (only analysis may omit `to`)
   *   - (analysis, *, set) → 400 VALIDATION (analysis always has `to_release = null`)
   * `analysis` briefs missing `fromReleaseName` default to the latest release
   * (mirrors `TransagentDispatcher.createChild`'s own resolution).
   * When `to=null` (analysis) the BRIEF_SAME_RELEASE guard and the
   * `getRelease(toName)` existence check are skipped.
   */
  async createBrief(
    opts: BriefCreateOpts,
  ): Promise<{ briefPath: string; fromReleaseName: string | null; toReleaseName: string | null }> {
    const source: BriefSource = opts.source ?? 'release-diff';
    let fromName = opts.fromReleaseName === null ? null : opts.fromReleaseName.trim();
    const toName = opts.toReleaseName === null ? null : opts.toReleaseName.trim();
    if (source === 'analysis' && fromName === null) {
      fromName = this.deps.releaseService.getLatestReleaseName();
    }
    if (fromName === null && toName === null) {
      throw new DomainError('VALIDATION', 'at least one of fromReleaseName / toReleaseName is required');
    }
    if (fromName !== null && fromName.length === 0) {
      throw new DomainError('VALIDATION', 'fromReleaseName must be non-empty (or null for initial brief)');
    }
    if (toName !== null && toName.length === 0) {
      throw new DomainError('VALIDATION', 'toReleaseName must be non-empty (or null for analysis brief)');
    }
    if (source === 'analysis' && toName !== null) {
      throw new DomainError('VALIDATION', "toReleaseName must be null when source = 'analysis'");
    }
    if (source === 'release-diff' && toName === null) {
      throw new DomainError('VALIDATION', "toReleaseName is required when source = 'release-diff'");
    }
    // 0.1.104 D4: roots is a dead field once `toReleaseName = null` (analysis).
    // Enforced here (not just the HTTP route) so in-process callers like
    // `TransagentDispatcher` can't bypass it.
    if (source === 'analysis' && opts.roots && opts.roots.length > 0) {
      throw new DomainError('VALIDATION', "roots is not allowed when source = 'analysis'");
    }
    // 0.1.69: analysis briefs (to=null) compare against HEAD — skip same-release
    // guard and the target-release existence check.
    if (toName !== null) {
      if (fromName !== null && fromName === toName) {
        throw new DomainError('BRIEF_SAME_RELEASE', 'from_release must differ from to_release');
      }
      this.deps.releaseService.getRelease(toName);
    }
    // Validate the source release exists (throws NOT_FOUND if missing). `fromName
    // === null` ⇒ initial brief, no fromRelease to validate.
    if (fromName !== null) this.deps.releaseService.getRelease(fromName);

    // 0.1.96: normalize scope — empty array is whole-release (no `roots` key/segment).
    const scopeRoots = opts.roots && opts.roots.length > 0 ? opts.roots : undefined;
    const briefPath = await this.allocatePath(fromName, toName, opts.suffix, scopeRoots);
    const frontmatter: BriefFrontmatter = {
      type: 'brief',
      source,
      from_release: fromName,
      to_release: toName,
      generated_at: new Date().toISOString(),
      generator_version: GENERATOR_VERSION,
      implemented: false,
      // 0.1.96: written verbatim; omitted entirely for whole-release scope.
      ...(scopeRoots ? { roots: scopeRoots } : {}),
    };
    const body =
      opts.content ??
      (toName === null
        ? `# Analysis brief: ${fromName} → (next)\n`
        : fromName === null
          ? `# Initial brief: ${toName}\n`
          : `# Brief: ${fromName} → ${toName}\n`);
    const fullContent = matter.stringify(body, frontmatter as Record<string, unknown>);

    const abs = this.absPath(briefPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    this.deps.briefsWatcher.suppress(briefPath);
    await fs.writeFile(abs, fullContent, 'utf-8');
    await this.deps.pageVersions.recordVersion(
      briefPath,
      'create',
      'user',
      undefined,
      this.deps.briefsSerializer,
      'brief',
    );
    // Re-sync indexer immediately (faster than waiting for watcher debounce —
    // the new brief should appear in `/briefs` list right after POST returns).
    await this.deps.frontmatterIndexer.indexPage(BRIEF_ROOT_MARKER, briefPath);

    return { briefPath, fromReleaseName: fromName, toReleaseName: toName };
  }

  async updateContent(opts: BriefUpdateContentOpts): Promise<{ newHash: string }> {
    const current = await this.getBrief(opts.path);
    if (typeof opts.expectedHash === 'string' && opts.expectedHash !== current.hash) {
      throw new ConflictError('BRIEF_CONFLICT', 'brief changed since last read', current.hash, current.content);
    }
    // Validate immutable frontmatter has not been altered in incoming content.
    const incoming = matter(opts.content);
    const incomingFm = (incoming.data ?? {}) as BriefFrontmatter;
    const violated: string[] = BRIEF_IMMUTABLE_FRONTMATTER_KEYS.filter(
      (k) => JSON.stringify(incomingFm[k]) !== JSON.stringify(current.frontmatter[k]),
    );
    // `implemented` is mutable for users (REST PATCH /frontmatter) but not for
    // agents — it is a fact about the implementation in a target repo, not part
    // of the brief narrative the agent author edits.
    if (
      opts.changedBy === 'agent' &&
      JSON.stringify(incomingFm.implemented) !== JSON.stringify(current.frontmatter.implemented)
    ) {
      violated.push('implemented');
    }
    if (violated.length > 0) {
      throw new DomainError(
        'IMMUTABLE_FIELD',
        `cannot mutate immutable frontmatter keys: ${violated.join(', ')}`,
      );
    }
    const abs = this.absPath(opts.path);
    this.deps.briefsWatcher.suppress(opts.path);
    await fs.writeFile(abs, opts.content, 'utf-8');
    await this.deps.pageVersions.recordVersion(
      opts.path,
      'update',
      opts.changedBy,
      undefined,
      this.deps.briefsSerializer,
      'brief',
      opts.changeSummary,
    );
    await this.deps.frontmatterIndexer.indexPage(BRIEF_ROOT_MARKER, opts.path);
    // The indexer only broadcasts `briefs:changed` when *frontmatter* changes; a
    // body-only edit (the common agent case) emits nothing, and the chokidar event
    // is suppressed above. Broadcast explicitly so open BriefEditors refresh.
    // `agent` writes are external from the editor's POV (reload/conflict-dialog);
    // a `user` write is this editor's own save (silent reconcile) — mirrors Pages.
    this.deps.ws.broadcast({
      kind: 'briefs:changed',
      path: opts.path,
      origin: opts.changedBy === 'agent' ? 'external' : 'server',
    });
    return { newHash: hashContent(opts.content) };
  }

  async updateFrontmatter(opts: BriefUpdateFrontmatterOpts): Promise<Brief> {
    const current = await this.getBrief(opts.path);
    const next: BriefFrontmatter = { ...current.frontmatter };
    const summaries: string[] = [];
    if (opts.patch.implemented !== undefined && opts.patch.implemented !== current.frontmatter.implemented) {
      next.implemented = opts.patch.implemented;
      summaries.push(`set implemented=${opts.patch.implemented}`);
    }
    const newContent = matter.stringify(current.body, next as Record<string, unknown>);
    const abs = this.absPath(opts.path);
    this.deps.briefsWatcher.suppress(opts.path);
    await fs.writeFile(abs, newContent, 'utf-8');
    await this.deps.pageVersions.recordVersion(
      opts.path,
      'update',
      opts.changedBy,
      undefined,
      this.deps.briefsSerializer,
      'brief',
      summaries.length > 0 ? summaries.join('; ') : null,
    );
    await this.deps.frontmatterIndexer.indexPage(BRIEF_ROOT_MARKER, opts.path);
    return this.getBrief(opts.path);
  }

  createThreadForBrief(opts: BriefThreadForBriefOpts): { threadId: string } {
    const thread = this.deps.chatService.createThread(opts.name ?? `Brief edit: ${opts.path}`, {
      contextType: 'brief',
      briefPath: opts.path,
      parentThreadId: opts.parentThreadId ?? null,
      spawnedByToolUseId: opts.spawnedByToolUseId ?? null,
    });
    return { threadId: thread.id };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private absPath(relPath: string): string {
    return path.join(this.deps.briefsPages.root, relPath);
  }

  private async allocatePath(
    fromName: string | null,
    toName: string | null,
    suffix?: string,
    roots?: string[],
  ): Promise<string> {
    const suf = suffix ? `-${slugify(suffix)}` : '';
    // 0.1.96: scoped brief gains a roots segment (`-{root-slug}[-{root-slug}]`);
    // omitted for whole-release scope (roots undefined/empty).
    const rootsSeg = roots && roots.length > 0 ? `-${roots.map(slugify).join('-')}` : '';
    // 0.1.69: analysis brief (to=null) — `{from-slug}-to-next[-{roots}][-{suffix}].md`.
    const base = toName === null
      ? `${slugify(fromName ?? 'head')}-to-next${rootsSeg}${suf}`
      : fromName === null
        ? `initial-${slugify(toName)}${rootsSeg}${suf}`
        : `${slugify(fromName)}-to-${slugify(toName)}${rootsSeg}${suf}`;
    let candidate = `${base}.md`;
    let n = 2;
    while (await this.deps.briefsPages.exists(candidate)) {
      candidate = `${base}-${n}.md`;
      n++;
      if (n > 1000) throw new DomainError('VALIDATION', 'brief filename collision overflow');
    }
    return candidate;
  }
}

export class ConflictError extends Error {
  readonly code: string;
  readonly currentHash: string;
  readonly currentContent?: string;
  constructor(code: string, message: string, currentHash: string, currentContent?: string) {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
    this.currentHash = currentHash;
    this.currentContent = currentContent;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'brief';
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}
