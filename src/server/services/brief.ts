/**
 * M21 BriefService — thin wrapper over the second `PagesService` instance
 * mounted on `briefsDir`. Briefs are markdown files with mandatory YAML
 * frontmatter (`type: brief`, `from_release`, `to_release`, ...). The file
 * itself is the source of truth (consumed both by humans in UI and by coding
 * agents in terminal). DB participation is limited to:
 *   - `chat_thread.brief_path` (M05) for editorial threads
 *   - `page_version` (M17 Phase 4) — automatic via shared PageVersionService
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
  BriefListItem,
  BriefThreadSummary,
} from '../../shared/entities.js';
import { BRIEF_IMMUTABLE_FRONTMATTER_KEYS } from '../../shared/entities.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { WsGateway } from '../ws/gateway.js';
import type { PageVersionService } from './page-version.js';
import type { PageSerializer } from './page-serializer.js';
import type { ChatService } from './chat.js';
import type { ReleaseService } from './release.js';
import type { PagesFrontmatterIndexer } from './pages-frontmatter-indexer.js';
import { DomainError } from './tags.js';

const GENERATOR_VERSION = 'brief-author@0.1';

export interface BriefServiceDeps {
  briefsPages: PagesService;
  briefsWatcher: PagesWatcher;
  briefsSerializer: PageSerializer;
  pageVersions: PageVersionService;
  chatService: ChatService;
  releaseService: ReleaseService;
  frontmatterIndexer: PagesFrontmatterIndexer;
  ws: WsGateway;
}

export interface BriefCreateOpts {
  /** `null` = initial brief — pomijamy walidacje `fromRelease` i frontmatter trzyma `from_release: null`. */
  fromReleaseName: string | null;
  toReleaseName: string;
  /**
   * Ulotny prompt sterujący stylem/językiem/audytorium briefa. NIE jest
   * zapisywany ani do frontmatter, ani do SQLite — klient dokleja go do
   * pierwszej user-message w initial-thread po redirect.
   */
  additionalPrompt?: string;
  suffix?: string;
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
    return {
      path,
      frontmatter,
      body: parsed.content,
      content,
      hash: hashContent(content),
    };
  }

  listBriefs(opts: BriefListOpts = {}): BriefListItem[] {
    const records = this.deps.frontmatterIndexer.findByFrontmatterType('brief', { rootDir: 'briefs' });
    const out: BriefListItem[] = [];
    for (const rec of records) {
      const fm = rec.frontmatter as BriefFrontmatter;
      const implemented = fm.implemented === true;
      if (opts.implemented !== undefined && opts.implemented !== implemented) continue;
      const lastVersion = this.deps.pageVersions.getLatestForPath(rec.path);
      out.push({
        path: rec.path,
        title: typeof fm.title === 'string' ? (fm.title as string) : null,
        fromRelease: typeof fm.from_release === 'string' ? fm.from_release : null,
        toRelease: String(fm.to_release ?? ''),
        implemented,
        generatedAt: String(fm.generated_at ?? ''),
        lastModifiedAt: lastVersion?.createdAt ?? null,
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

  async createBrief(opts: BriefCreateOpts): Promise<{ briefPath: string; initialThreadId: string }> {
    const fromName = opts.fromReleaseName === null ? null : opts.fromReleaseName.trim();
    const toName = opts.toReleaseName.trim();
    if (!toName) {
      throw new DomainError('VALIDATION', 'toReleaseName is required');
    }
    if (fromName !== null && fromName.length === 0) {
      throw new DomainError('VALIDATION', 'fromReleaseName must be non-empty (or null for initial brief)');
    }
    if (fromName !== null && fromName === toName) {
      throw new DomainError('BRIEF_SAME_RELEASE', 'from_release must differ from to_release');
    }
    // Validate releases exist (throws NOT_FOUND if missing). `fromName === null`
    // ⇒ initial brief, brak `fromRelease` do walidacji.
    if (fromName !== null) this.deps.releaseService.getRelease(fromName);
    this.deps.releaseService.getRelease(toName);

    const briefPath = await this.allocatePath(fromName, toName, opts.suffix);
    // opts.additionalPrompt is intentionally not persisted — klient dokleja go
    // do pierwszej user-message w initial-thread po redirect.
    const frontmatter: BriefFrontmatter = {
      type: 'brief',
      from_release: fromName,
      to_release: toName,
      generated_at: new Date().toISOString(),
      generator_version: GENERATOR_VERSION,
      implemented: false,
    };
    const body = fromName === null
      ? `# Initial brief: ${toName}\n`
      : `# Brief: ${fromName} → ${toName}\n`;
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
    await this.deps.frontmatterIndexer.indexPage('briefs', briefPath);

    const threadTitle = fromName === null
      ? `Initial brief: ${toName}`
      : `Brief: ${fromName} → ${toName}`;
    const initialThread = this.deps.chatService.createThread(threadTitle, {
      contextType: 'brief',
      briefPath,
    });
    return { briefPath, initialThreadId: initialThread.id };
  }

  async updateContent(opts: BriefUpdateContentOpts): Promise<{ newHash: string }> {
    const current = await this.getBrief(opts.path);
    if (typeof opts.expectedHash === 'string' && opts.expectedHash !== current.hash) {
      throw new ConflictError('BRIEF_CONFLICT', 'brief changed since last read', current.hash);
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
        'BRIEF_FRONTMATTER_IMMUTABLE',
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
    await this.deps.frontmatterIndexer.indexPage('briefs', opts.path);
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
    await this.deps.frontmatterIndexer.indexPage('briefs', opts.path);
    return this.getBrief(opts.path);
  }

  createThreadForBrief(briefPath: string, name?: string | null): { threadId: string } {
    const thread = this.deps.chatService.createThread(name ?? `Brief edit: ${briefPath}`, {
      contextType: 'brief',
      briefPath,
    });
    return { threadId: thread.id };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private absPath(relPath: string): string {
    return path.join(this.deps.briefsPages.root, relPath);
  }

  private async allocatePath(fromName: string | null, toName: string, suffix?: string): Promise<string> {
    const base = fromName === null
      ? `initial-${slugify(toName)}${suffix ? `-${slugify(suffix)}` : ''}`
      : `${slugify(fromName)}-to-${slugify(toName)}${suffix ? `-${slugify(suffix)}` : ''}`;
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
  constructor(code: string, message: string, currentHash: string) {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
    this.currentHash = currentHash;
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
