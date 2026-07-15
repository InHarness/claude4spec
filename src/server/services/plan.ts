/**
 * 0.1.127 M10 PlanService — filesystem-backed, mirrors BriefService/PatchService
 * (M36 consumer-slice pattern) instead of the pre-0.1.127 SQLite `plan`/
 * `plan_version` tables (see brief 0-1-126-to-0-1-127). A plan is a markdown
 * file in `plansDir` with mandatory frontmatter (`type: plan`, `title`,
 * `created_at`, `created_by`); identity is the file path (`slug =
 * slugify(title)`, immutable once created — a later title edit changes
 * frontmatter only, never the filename/route).
 *
 * DB participation is limited to:
 *   - `chat_thread.plan_path` (M05) — N:1 attach, optional, no FK
 *     (`danglingPolicy: graceful-degrade`: deleting the file leaves attached
 *     threads pointing nowhere; the UI degrades to a banner instead of the
 *     invariant brief/patch enforce).
 *   - `file_version` (M17) — automatic via the shared FileVersionService,
 *     keyed by `rootId = PLAN_ROOT_MARKER`. `currentVersion` is derived from
 *     this table (MAX(version) for the path), NOT a stored column — the old
 *     `plan.current_version` DB column no longer exists.
 *
 * Design notes (mirrors brief.ts):
 *   - **Zero new tables**. Listing comes from PagesFrontmatterIndexer.
 *   - **Optimistic concurrency** by sha256 hash of full content (frontmatter+body).
 *   - **Immutable frontmatter** keys protected: type/created_at/created_by.
 *     Only `title` is mutable.
 *   - Anchor injection (`<!-- anchor: xxxxxxxx -->` before headings) stays a
 *     local pure function here rather than a shared M06 utility — no such
 *     shared utility exists in this codebase yet (checked section-indexer.ts);
 *     `plan` is still the only registry entry with `anchorInjection: true`, so
 *     there is nothing else to share it with. Flagged as a `clarification`
 *     patch for the spec author.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import { customAlphabet } from 'nanoid';
import type {
  Plan,
  PlanAction,
  PlanChangedBy,
  PlanExecuteMode,
  PlanExecuteResult,
  PlanFrontmatter,
  PlanListItem,
  PlanThreadItem,
} from '../../shared/entities.js';
import { PLAN_IMMUTABLE_FRONTMATTER_KEYS } from '../../shared/entities.js';
import { PLAN_ROOT_MARKER } from '../../shared/types.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import { slugify } from './slug.js';
import type { PagesService } from './pages.js';
import type { PagesWatcher } from '../fs/watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { FileVersionService } from './file-version.js';
import type { FileSerializer } from './file-serializer.js';
import type { ChatService } from './chat.js';
import type { PagesFrontmatterIndexer } from './pages-frontmatter-indexer.js';
import { DomainError } from './tags.js';
import { ConflictError } from './brief.js';

// Generator stays strict 8 (per M06 spec `15u7sazr` — auto-inject contract).
const nanoid8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const PLAN_HEADING_RE = /^(#{2,4})\s+(.+?)\s*$/;

export interface PlanServiceDeps {
  plansPages: PagesService;
  plansWatcher: PagesWatcher;
  plansSerializer: FileSerializer;
  pageVersions: FileVersionService;
  chatService: ChatService;
  frontmatterIndexer: PagesFrontmatterIndexer;
  ws: WsEmitter;
}

export interface PlanUpdateInput {
  threadId: string;
  action: PlanAction;
  content: string;
  anchor?: string;
  heading?: string;
  /** Required on the first call in a thread (creates the file) — MISSING_TITLE otherwise. */
  title?: string;
  changeSummary?: string;
  changedBy: PlanChangedBy;
}

export interface PlanUpdateResult {
  plan: Plan;
  version: number;
}

export interface PlanUpdateContentOpts {
  path: string;
  content: string;
  expectedHash?: string;
  changedBy: PlanChangedBy;
  changeSummary?: string;
}

export interface PlanUpdateFrontmatterOpts {
  path: string;
  patch: { title?: string };
  changedBy: PlanChangedBy;
}

export class PlanService {
  constructor(private deps: PlanServiceDeps) {}

  /** Per-key (plan path, or thread while the plan doesn't exist yet) write queue. */
  private locks = new Map<string, Promise<unknown>>();

  /**
   * Serializes read-modify-write cycles per `key` — the filesystem gives no
   * transaction to provide this, unlike the SQLite `BEGIN IMMEDIATE` the
   * pre-0.1.127 implementation relied on. Queued via chained promises rather
   * than a real mutex library since this only needs to serialize calls within
   * this single process/service instance.
   */
  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    const settled = prior.then(
      () => undefined,
      () => undefined,
    );
    const run = settled.then(fn);
    this.locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  async getByPath(planPath: string): Promise<Plan> {
    if (!(await this.deps.plansPages.exists(planPath))) {
      throw new DomainError('NOT_FOUND', `plan '${planPath}' not found`);
    }
    const abs = this.absPath(planPath);
    const raw = await fs.readFile(abs, 'utf-8');
    const parsed = matter(raw);
    const frontmatter = (parsed.data ?? {}) as PlanFrontmatter;
    if (frontmatter.type !== 'plan') {
      throw new DomainError(
        'PLAN_INVALID_FRONTMATTER',
        `file '${planPath}' is not a plan (frontmatter.type=${JSON.stringify(frontmatter.type)})`,
      );
    }
    return {
      path: planPath,
      frontmatter,
      body: parsed.content,
      content: raw,
      hash: hashContent(raw),
      currentVersion: this.currentVersionFor(planPath),
      createdAt: String(frontmatter.created_at ?? ''),
      updatedAt: this.deps.pageVersions.getLatestForPath(planPath, undefined, PLAN_ROOT_MARKER)?.createdAt ?? String(frontmatter.created_at ?? ''),
    };
  }

  async getByThread(threadId: string): Promise<Plan | null> {
    const planPath = this.deps.chatService.getThreadPlanPath(threadId);
    if (!planPath) return null;
    return this.getByPath(planPath);
  }

  /**
   * Resolve a heading anchor (the `<!-- anchor: xxxxxxxx -->` marker injected
   * by {@link injectAnchors}) back to the plan that contains it. Plans are not
   * indexed in `section_index` (`sectionIndexed: false`), so a brute-force
   * scan over `plansDir`'s files is used instead — acceptable given the low
   * plan count (same justification as the pre-0.1.127 DB `content LIKE` scan
   * this replaces). `threadId` is best-effort (the plan's OLDEST attached
   * thread, or null) — a stable reference point so the same anchor link keeps
   * resolving to the same thread even as other threads keep editing the plan;
   * callers otherwise navigate by `planPath`.
   */
  async getByAnchor(anchor: string): Promise<{ planPath: string; threadId: string | null } | null> {
    if (!/^[a-z0-9]{6,12}$/.test(anchor)) return null;
    const needle = `<!-- anchor: ${anchor} -->`;
    const files = await this.deps.plansPages.listMarkdownFiles();
    for (const relPath of files) {
      const abs = this.absPath(relPath);
      let raw: string;
      try {
        raw = await fs.readFile(abs, 'utf-8');
      } catch {
        continue; // deleted between listMarkdownFiles() and read
      }
      if (raw.includes(needle)) {
        return { planPath: relPath, threadId: this.deps.chatService.findOldestThreadIdForPlan(relPath) };
      }
    }
    return null;
  }

  listPlans(opts: { search?: string } = {}): PlanListItem[] {
    const records = this.deps.frontmatterIndexer.findByFrontmatterType('plan', { rootId: PLAN_ROOT_MARKER });
    const search = opts.search?.trim().toLowerCase();
    const out: PlanListItem[] = [];
    for (const rec of records) {
      const fm = rec.frontmatter as PlanFrontmatter;
      const title = typeof fm.title === 'string' ? fm.title : null;
      if (search && !(title?.toLowerCase().includes(search) ?? false) && !rec.path.toLowerCase().includes(search)) {
        continue;
      }
      const lastVersion = this.deps.pageVersions.getLatestForPath(rec.path, undefined, PLAN_ROOT_MARKER);
      out.push({
        path: rec.path,
        title,
        threadCount: this.deps.chatService.threadCountForPlan(rec.path),
        lastThreadId: this.deps.chatService.findLastThreadIdForPlan(rec.path),
        updatedAt: lastVersion?.createdAt ?? String(fm.created_at ?? ''),
        frontmatter: fm,
        hash: lastVersion ? hashContent(lastVersion.data.content) : '',
      });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  listThreadsForPlan(planPath: string): PlanThreadItem[] {
    return this.deps.chatService.listThreadsForPlan(planPath).map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
    }));
  }

  findLastThreadIdForPlan(planPath: string): string | null {
    return this.deps.chatService.findLastThreadIdForPlan(planPath);
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  async attachThreadToPlan(planPath: string): Promise<{ threadId: string }> {
    // Resolve existence via getByPath (a direct filesystem check), not the
    // in-memory frontmatter index — the index is populated asynchronously
    // (file watcher / boot-time indexAll()), so a plan written moments ago
    // (e.g. by the boot-time SQLite->filesystem backfill) can otherwise be
    // reported NOT_FOUND here even though it's fully readable on disk.
    const plan = await this.getByPath(planPath);
    const title = typeof plan.frontmatter.title === 'string' ? plan.frontmatter.title : planPath;
    const newThread = this.deps.chatService.createThread(title);
    this.deps.chatService.attachPlanToThread(newThread.id, planPath);
    return { threadId: newThread.id };
  }

  /**
   * MCP `update_plan` handler logic. First call in a thread (`plan_path IS
   * NULL`) requires `title`, creates the file (`slug = slugify(title)`,
   * disambiguated on collision, then immutable) and attaches the thread.
   * Subsequent calls compose against the existing content and overwrite.
   *
   * The whole read-modify-write cycle runs inside {@link withLock}, keyed by
   * the target plan path (or by thread while the plan doesn't exist yet) —
   * filesystem writes have no transaction to serialize concurrent editors the
   * way the pre-0.1.127 SQLite `BEGIN IMMEDIATE` transaction did, so two
   * threads attached to the same plan calling `update_plan` back-to-back
   * would otherwise silently clobber each other.
   */
  async update(input: PlanUpdateInput): Promise<PlanUpdateResult> {
    const { threadId, action, content, anchor, heading, title, changeSummary, changedBy } = input;
    const lockKey = this.deps.chatService.getThreadPlanPath(threadId) ?? `thread:${threadId}`;

    return this.withLock(lockKey, async () => {
      // Re-resolve inside the lock: another call for the same thread may have
      // created the plan while this call was waiting its turn.
      const existingPath = this.deps.chatService.getThreadPlanPath(threadId);

      if (!existingPath) {
        const trimmedTitle = title?.trim();
        if (!trimmedTitle) {
          throw new DomainError('MISSING_TITLE', 'title is required on the first update_plan call in a thread');
        }
        const planPath = await this.allocatePath(trimmedTitle);
        const finalContent = injectAnchors(composeContent('', action, content, anchor, heading));
        const frontmatter: PlanFrontmatter = {
          type: 'plan',
          title: trimmedTitle,
          created_at: new Date().toISOString(),
          created_by: changedBy,
        };
        const fullContent = matter.stringify(finalContent, frontmatter as Record<string, unknown>);
        const abs = this.absPath(planPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        this.deps.plansWatcher.suppress(planPath);
        await fs.writeFile(abs, fullContent, 'utf-8');
        await this.deps.pageVersions.recordVersion(
          planPath,
          'create',
          toFileChangedBy(changedBy),
          undefined,
          this.deps.plansSerializer,
          PLAN_ROOT_MARKER,
          changeSummary,
        );
        await this.deps.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, planPath);
        this.deps.chatService.attachPlanToThread(threadId, planPath);

        const version = this.currentVersionFor(planPath);
        const plan = await this.getByPath(planPath);
        this.deps.ws.broadcast({ kind: 'plan:updated', planPath, threadId, version, changedBy });
        return { plan, version };
      }

      const current = await this.getByPath(existingPath);
      const finalContent = injectAnchors(composeContent(current.body, action, content, anchor, heading));
      const fullContent = matter.stringify(finalContent, current.frontmatter as Record<string, unknown>);
      const abs = this.absPath(existingPath);
      this.deps.plansWatcher.suppress(existingPath);
      await fs.writeFile(abs, fullContent, 'utf-8');
      await this.deps.pageVersions.recordVersion(
        existingPath,
        'update',
        toFileChangedBy(changedBy),
        undefined,
        this.deps.plansSerializer,
        PLAN_ROOT_MARKER,
        changeSummary,
      );
      await this.deps.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, existingPath);

      const version = this.currentVersionFor(existingPath);
      const plan = await this.getByPath(existingPath);
      this.deps.ws.broadcast({ kind: 'plan:updated', planPath: existingPath, threadId, version, changedBy });
      return { plan, version };
    });
  }

  async updateContent(opts: PlanUpdateContentOpts): Promise<{ newHash: string }> {
    return this.withLock(opts.path, async () => {
      const current = await this.getByPath(opts.path);
      if (typeof opts.expectedHash === 'string' && opts.expectedHash !== current.hash) {
        throw new ConflictError('PLAN_CONFLICT', 'plan changed since last read', current.hash, current.content);
      }
      const incoming = matter(opts.content);
      const incomingFm = (incoming.data ?? {}) as PlanFrontmatter;
      const violated = PLAN_IMMUTABLE_FRONTMATTER_KEYS.filter(
        (k) => JSON.stringify(incomingFm[k]) !== JSON.stringify(current.frontmatter[k]),
      );
      if (violated.length > 0) {
        throw new DomainError('IMMUTABLE_FIELD', `cannot mutate immutable frontmatter keys: ${violated.join(', ')}`);
      }
      const abs = this.absPath(opts.path);
      this.deps.plansWatcher.suppress(opts.path);
      await fs.writeFile(abs, opts.content, 'utf-8');
      await this.deps.pageVersions.recordVersion(
        opts.path,
        'update',
        toFileChangedBy(opts.changedBy),
        undefined,
        this.deps.plansSerializer,
        PLAN_ROOT_MARKER,
        opts.changeSummary,
      );
      await this.deps.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, opts.path);
      return { newHash: hashContent(opts.content) };
    });
  }

  async updateFrontmatter(opts: PlanUpdateFrontmatterOpts): Promise<Plan> {
    return this.withLock(opts.path, async () => {
      const current = await this.getByPath(opts.path);
      const next: PlanFrontmatter = { ...current.frontmatter };
      const summaries: string[] = [];
      if (opts.patch.title !== undefined && opts.patch.title !== current.frontmatter.title) {
        next.title = opts.patch.title;
        summaries.push(`set title=${opts.patch.title}`);
      }
      const newContent = matter.stringify(current.body, next as Record<string, unknown>);
      const abs = this.absPath(opts.path);
      this.deps.plansWatcher.suppress(opts.path);
      await fs.writeFile(abs, newContent, 'utf-8');
      await this.deps.pageVersions.recordVersion(
        opts.path,
        'update',
        toFileChangedBy(opts.changedBy),
        undefined,
        this.deps.plansSerializer,
        PLAN_ROOT_MARKER,
        summaries.length > 0 ? summaries.join('; ') : null,
      );
      await this.deps.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, opts.path);
      return this.getByPath(opts.path);
    });
  }

  async execute(
    planPath: string,
    mode: PlanExecuteMode,
    opts: { threadId?: string } = {},
  ): Promise<PlanExecuteResult> {
    const plan = await this.getByPath(planPath);
    if (plan.body.trim().length === 0) {
      throw new DomainError('VALIDATION', 'cannot execute an empty plan');
    }

    if (mode === 'new-session') {
      const { threadId: newThreadId } = await this.attachThreadToPlan(plan.path);
      this.deps.chatService.updateThreadSettings(newThreadId, { planMode: false });
      const firstMessage = `Executing plan "${plan.frontmatter.title}" — disabling planMode and proceeding with implementation.`;
      return { mode: 'new-session', newThreadId, planPath: plan.path, firstMessage };
    }

    // mode === 'continue'
    const threadId = opts.threadId;
    if (!threadId) {
      throw new DomainError('VALIDATION', "mode='continue' requires `threadId` in body");
    }
    const attachedThread = this.deps.chatService.getThreadMeta(threadId);
    if (!attachedThread) {
      throw new DomainError('NOT_FOUND', `thread '${threadId}' not found`);
    }
    if (attachedThread.planPath !== plan.path) {
      throw new DomainError(
        'THREAD_NOT_ATTACHED_TO_PLAN',
        `thread '${threadId}' is not attached to plan '${plan.path}'`,
      );
    }
    this.deps.chatService.updateThreadSettings(threadId, { planMode: false });
    const firstMessage = `Executing plan "${plan.frontmatter.title}" — disabling planMode and proceeding with implementation.`;
    return { mode: 'continue', threadId, firstMessage };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private absPath(relPath: string): string {
    return path.join(this.deps.plansPages.root, relPath);
  }

  private currentVersionFor(planPath: string): number {
    return this.deps.pageVersions.getLatestForPath(planPath, undefined, PLAN_ROOT_MARKER)?.version ?? 0;
  }

  private async allocatePath(title: string): Promise<string> {
    const base = slugify(title) || 'plan';
    let candidate = `${base}.md`;
    let n = 2;
    while (await this.deps.plansPages.exists(candidate)) {
      candidate = `${base}-${n}.md`;
      n++;
      if (n > 1000) throw new DomainError('VALIDATION', 'plan filename collision overflow');
    }
    return candidate;
  }
}

function composeContent(prior: string, action: PlanAction, input: string, anchor?: string, heading?: string): string {
  switch (action) {
    case 'replace':
    case 'user_edit':
    case 'system_duplicate':
      return input;
    case 'append': {
      if (prior.trim().length === 0) return input;
      const sep = prior.endsWith('\n') ? '\n' : '\n\n';
      return `${prior}${sep}${input}`;
    }
    case 'insert_after_section': {
      if (!anchor && !heading) {
        throw new DomainError('MISSING_TARGET', 'insert_after_section requires anchor or heading');
      }
      return insertAfterSection(prior, input, anchor, heading);
    }
  }
}

function insertAfterSection(prior: string, fragment: string, anchor?: string, heading?: string): string {
  const lines = prior.split('\n');

  let targetLine = -1;
  let targetLevel = -1;
  const matches: Array<{ line: number; level: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(PLAN_HEADING_RE);
    if (!m) continue;
    const level = m[1]!.length;
    const text = m[2]!.trim();

    if (anchor) {
      const prev = i > 0 ? lines[i - 1]! : '';
      const anchorMatch = prev.match(ANCHOR_RE);
      if (anchorMatch && anchorMatch[1] === anchor) {
        targetLine = i;
        targetLevel = level;
        break;
      }
    } else if (heading) {
      if (text === heading.trim()) {
        matches.push({ line: i, level });
      }
    }
  }

  if (targetLine === -1 && heading && !anchor) {
    if (matches.length === 0) {
      throw new DomainError('SECTION_NOT_FOUND', `section with heading "${heading}" not found`);
    }
    if (matches.length > 1) {
      throw new DomainError('AMBIGUOUS_HEADING', `heading "${heading}" matches ${matches.length} sections`);
    }
    targetLine = matches[0]!.line;
    targetLevel = matches[0]!.level;
  }

  if (targetLine === -1) {
    throw new DomainError(
      'SECTION_NOT_FOUND',
      anchor ? `section with anchor "${anchor}" not found` : `section not found`,
    );
  }

  let endLine = lines.length;
  for (let i = targetLine + 1; i < lines.length; i++) {
    const m = lines[i]!.match(PLAN_HEADING_RE);
    if (m && m[1]!.length <= targetLevel) {
      endLine = i;
      break;
    }
  }

  const before = lines.slice(0, endLine).join('\n');
  const after = lines.slice(endLine).join('\n');
  const separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const afterSep = after.length > 0 ? '\n\n' : '';
  return `${before}${separator}${fragment}${afterSep}${after}`.replace(/\n{3,}/g, '\n\n');
}

function injectAnchors(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(PLAN_HEADING_RE);
    if (!m) {
      out.push(line);
      continue;
    }
    const prev = out.length > 0 ? out[out.length - 1]! : '';
    if (ANCHOR_RE.test(prev)) {
      out.push(line);
      continue;
    }
    out.push(`<!-- anchor: ${nanoid8()} -->`);
    out.push(line);
  }
  return out.join('\n');
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * `PlanChangedBy` ('agent'|'user'|'system') is the plan-domain WS/frontmatter
 * concept; `FileChangedBy` ('user'|'agent'|'filesystem') is the storage-level
 * concept `FileVersionService.recordVersion` expects. Only 'system' has no
 * direct match — mapped to 'filesystem' (non-user/non-agent origin), the
 * closest existing meaning.
 */
function toFileChangedBy(changedBy: PlanChangedBy): 'user' | 'agent' | 'filesystem' {
  return changedBy === 'system' ? 'filesystem' : changedBy;
}
