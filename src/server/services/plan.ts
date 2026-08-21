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
import matter from 'gray-matter';
import { customAlphabet } from 'nanoid';
import type { Plan, PlanChangedBy, PlanFrontmatter, PlanListItem } from '../../shared/entities.js';
import { PLAN_IMMUTABLE_FRONTMATTER_KEYS } from '../../shared/entities.js';
import { PLAN_ROOT_MARKER } from '../../shared/types.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import { slugify } from './slug.js';
import type { PagesService } from './pages.js';
import type { SelfWriteMarker } from '../fs/sources.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { FileVersionService } from './file-version.js';
import type { FileSerializer } from './file-serializer.js';
import type { ChatService } from './chat.js';
import type { PagesFrontmatterIndexer } from './pages-frontmatter-indexer.js';
import { DomainError } from './tags.js';
import { readArtifactWindow, windowBody, type ArtifactRange } from './artifact-read.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import { ConflictError } from './brief.js';
import { hashContent, toIso } from './artifact-content.js';
import { anchorDelta, sectionDigests, sectionRanges } from './section-text.js';
import {
  applyPlanBatch,
  selectPlanVariant,
  type PlanEditPayload,
  type PlanEditResult,
  type PlanSectionEdit,
} from './plan-write.js';
import { applyTextEdits, type TextEdit } from './text-edits.js';

// Generator stays strict 8 (per M06 spec `15u7sazr` — auto-inject contract).
const nanoid8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const PLAN_HEADING_RE = /^(#{2,4})\s+(.+?)\s*$/;

export interface PlanServiceDeps {
  plansPages: PagesService;
  plansWatcher: SelfWriteMarker;
  plansSerializer: FileSerializer;
  pageVersions: FileVersionService;
  chatService: ChatService;
  frontmatterIndexer: PagesFrontmatterIndexer;
  ws: WsEmitter;
}

export interface PlanUpdateInput {
  /**
   * The thread whose plan this is — the `internal` channel's DEFAULT way to
   * address a plan, not part of the operation's contract (0.2.13 §7: "a plan is
   * addressed explicitly by `path`; the `chat_thread.plan_path` binding is a
   * default of the internal channel").
   *
   * A channel with no thread passes `planPath` instead. Passing a synthetic id
   * here does not work and must not be attempted: it resolves to no plan, so
   * every call takes the create branch, writes a file, and then throws
   * NOT_FOUND attaching it to a thread that does not exist — leaving an orphan
   * plan behind on each attempt.
   */
  threadId: string;
  /**
   * 0.2.13: address the plan directly, for a channel that has no thread. When
   * given, the thread binding is neither read nor written.
   */
  planPath?: string;
  /**
   * 0.2.43 — EXACTLY ONE of `content` / `textEdits` / `edits`, which is what
   * replaced the old top-level `action` dictionary.
   *
   * Optional in this TYPE because "exactly one of three" is not a shape a
   * TypeScript field can carry; the enforcement is {@link selectPlanVariant},
   * run before anything touches the plan file so a malformed call can neither
   * create a plan nor bump a version.
   */
  content?: string;
  /** Literal substitutions counted over the WHOLE plan. See {@link PlanUpdateInput.content}. */
  textEdits?: TextEdit[];
  /** A transactional section batch, one entry per section. See {@link PlanUpdateInput.content}. */
  edits?: PlanSectionEdit[];
  /** Required on the first call in a thread (creates the file) — MISSING_TITLE otherwise. */
  title?: string;
  /**
   * 0.2.15 — the optimistic-concurrency guard, REQUIRED by the operation on
   * every call except the first one in a thread (which creates the file and has
   * nothing to be stale against).
   *
   * Optional in this TYPE rather than required, because the create branch is the
   * documented exemption and a required field would have to be faked there. The
   * enforcement that matters — refusing a call that omits it against an existing
   * plan — lives in {@link PlanService.update}, so it applies to every channel
   * rather than to whichever one remembered to check.
   *
   * A plan has SEVERAL concurrent writers (an agent turn, a save from the plan
   * editor, an N:1 model attach), which is precisely why last-write-wins was
   * losing content quietly here and is tolerated for, say, a tag assignment.
   */
  expectedHash?: string;
  changeSummary?: string;
  changedBy: PlanChangedBy;
}

export interface PlanUpdateResult {
  plan: Plan;
  version: number;
  /**
   * 0.2.43 — one row per edit for the `edits` variant, in the order the caller
   * GAVE them (not the bottom-up order they were applied in); a single row with
   * `anchor: null` for the two whole-plan variants.
   *
   * The plan's content is deliberately not among them: a write answers with the
   * address of its effect and the deltas the caller could not predict, never
   * with an echo of what it just sent.
   */
  results: PlanEditResult[];
  /**
   * 0.2.15 — sha256 of the content just written. The caller needs it to arm the
   * NEXT call's `expectedHash`; without it every write would have to be followed
   * by a read, and the window between the two is exactly the race the guard
   * exists to close.
   */
  hash: string;
}

/** What {@link composePlanBody} produces: the new body, plus what the response needs. */
interface ComposedPlanBody {
  body: string;
  /** Per addressed anchor, the anchors its range covered before the splice. */
  scopeOf: Map<string, string[]>;
  /** Per addressed anchor of an `edit`, how many substitutions it made. */
  replacementsOf: Map<string, number>;
  /** The top-level `textEdits` variant's total, which addresses no anchor. */
  replacements?: number;
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
  patch: { title?: string; applied?: boolean };
  changedBy: PlanChangedBy;
  /**
   * 0.2.15 — the thread that CAUSED this write, or `null` when the caller has
   * none (the generic `PATCH …/frontmatter` route).
   *
   * Required rather than optional so every caller states it. It used to be
   * derived here, via `findLastThreadIdForPlan`, which meant a REST write with
   * no thread behind it was published as having been made by whichever thread
   * happened to attach last — a plausible-looking attribution that was simply
   * false, and indistinguishable from a true one downstream.
   */
  threadId: string | null;
}

/** Input of {@link PlanService.setAppliedByThread} — the `mark_plan_applied` operation. */
export interface PlanSetAppliedInput {
  /** Plan path relative to plansDir. Defaulted from the thread in the `internal` channel. */
  path?: string;
  /** Required. Only `true` passes through the agent channel — see the method. */
  applied: boolean;
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

  /**
   * 0.2.40 — the artifact read family's window: `range` is a 1-based inclusive
   * line window, unconditionally allowed (no `sectionIndexed` gate — a plan never
   * enters `section_index`), and a `start` past the end of the file is
   * `INVALID_ARGUMENT` STATING the size. The mechanism is shared with brief and
   * plan in `artifact-read.ts`; this kind declares a value for it, it does not
   * implement a variant of it.
   *
   * `hash` stays the digest of the whole file — see `readArtifactWindow`.
   */
  async getByPath(planPath: string, opts?: { range?: ArtifactRange }): Promise<Plan> {
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
    const windowed = readArtifactWindow(
      raw,
      opts?.range,
      { kind: 'plan', path: planPath },
      Math.floor(DEFAULT_BUDGET_CHARS / 2),
    );
    return {
      path: planPath,
      frontmatter,
      body:
        windowed.content === raw
          ? parsed.content
          : windowBody(raw, windowed.content, opts?.range?.start ?? 1),
      content: windowed.content,
      hash: hashContent(raw),
      ...(windowed.truncated
        ? { truncated: windowed.truncated, truncationHint: windowed.truncationHint }
        : {}),
      currentVersion: this.currentVersionFor(planPath),
      createdAt: toIso(frontmatter.created_at),
      updatedAt: this.deps.pageVersions.getLatestForPath(planPath, undefined, PLAN_ROOT_MARKER)?.createdAt ?? toIso(frontmatter.created_at),
    };
  }

  async getByThread(threadId: string, opts?: { range?: ArtifactRange }): Promise<Plan | null> {
    const planPath = this.deps.chatService.getThreadPlanPath(threadId);
    if (!planPath) return null;
    return this.getByPath(planPath, opts);
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

  /**
   * `includeThreadInfo` (v0.1.129 fix, default `false`) gates `threadCount`/
   * `lastThreadId` — 2 extra `chatService` queries PER plan. The generic
   * `/api/artifacts/plan` REST route (routes/artifacts.ts's
   * `buildPlanAdapter.list()`) never reads either field off `PlanListItem`
   * (the wire `ArtifactListItem` doesn't carry them at all), so both used to
   * run on every list call — 2N wasted queries for N plans on every page load
   * / search keystroke. Pass `true` for a caller that actually needs them.
   */
  listPlans(opts: { search?: string; applied?: boolean; includeThreadInfo?: boolean } = {}): PlanListItem[] {
    const records = this.deps.frontmatterIndexer.findByFrontmatterType('plan', { rootId: PLAN_ROOT_MARKER });
    const search = opts.search?.trim().toLowerCase();
    const out: PlanListItem[] = [];
    for (const rec of records) {
      const fm = rec.frontmatter as PlanFrontmatter;
      const title = typeof fm.title === 'string' ? fm.title : null;
      if (search && !(title?.toLowerCase().includes(search) ?? false) && !rec.path.toLowerCase().includes(search)) {
        continue;
      }
      // A plan with no `applied` key counts as `false` — the filter reads the
      // indexer's frontmatter, so no file is opened per row.
      if (opts.applied !== undefined && opts.applied !== (fm.applied === true)) continue;
      const lastVersion = this.deps.pageVersions.getLatestForPath(rec.path, undefined, PLAN_ROOT_MARKER);
      out.push({
        path: rec.path,
        title,
        threadCount: opts.includeThreadInfo ? this.deps.chatService.threadCountForPlan(rec.path) : 0,
        lastThreadId: opts.includeThreadInfo ? this.deps.chatService.findLastThreadIdForPlan(rec.path) : null,
        updatedAt: lastVersion?.createdAt ?? toIso(fm.created_at),
        frontmatter: fm,
        hash: lastVersion ? hashContent(lastVersion.data.content) : '',
      });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
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
   * The `update_plan` operation — 0.2.43's three input variants, one write.
   *
   * First call in a thread (`plan_path IS NULL`) requires `title`, creates the
   * file (`slug = slugify(title)`, disambiguated on collision, then immutable)
   * and attaches the thread. Subsequent calls compose against the existing
   * content and overwrite.
   *
   * ## Order of the gates, which is part of the contract
   *
   * 1. **Variant selection**, before any I/O at all: exactly one of `content` /
   *    `textEdits` / `edits`, and a batch whose shape is internally consistent.
   * 2. **`MISSING_TITLE`**, before anchors are resolved — in EVERY variant. A
   *    thread with no plan and no title cannot be answered with
   *    `SECTION_NOT_FOUND`; it has not got as far as having sections.
   * 3. **The hash guard**, then the composition, then one write.
   *
   * Nothing is written until the whole composition has succeeded in memory, so a
   * batch is all-or-nothing: one rejected entry means no file change, no
   * `file_version` row and no `plan:updated`.
   *
   * The whole read-modify-write cycle runs inside {@link withLock}, keyed by
   * the target plan path (or by thread while the plan doesn't exist yet) —
   * filesystem writes have no transaction to serialize concurrent editors the
   * way the pre-0.1.127 SQLite `BEGIN IMMEDIATE` transaction did, so two
   * threads attached to the same plan calling `update_plan` back-to-back
   * would otherwise silently clobber each other.
   */
  async update(input: PlanUpdateInput): Promise<PlanUpdateResult> {
    const { threadId, planPath: addressed, title, expectedHash, changeSummary, changedBy } = input;
    /**
     * Before the lock, before the filesystem, before anything: a call that names
     * two variants or none is a mistake in the REQUEST, and answering it must
     * not have cost a plan file or a version row.
     */
    const payload = selectPlanVariant(input);
    /**
     * An explicitly addressed plan must EXIST — this path does not create one.
     * Creation is thread-bound by design (§7: "a plan is born only from a
     * thread"), so a channel with no thread can edit plans and not mint them.
     */
    if (addressed !== undefined) await this.requirePlan(addressed);
    const lockKey = addressed ?? this.deps.chatService.getThreadPlanPath(threadId) ?? `thread:${threadId}`;

    return this.withLock(lockKey, async () => {
      // Re-resolve inside the lock: another call for the same thread may have
      // created the plan while this call was waiting its turn.
      const existingPath = addressed ?? this.deps.chatService.getThreadPlanPath(threadId);

      if (!existingPath) {
        const trimmedTitle = title?.trim();
        if (!trimmedTitle) {
          throw new DomainError(
            'MISSING_TITLE',
            'title is required on the first update_plan call in a thread',
            'pass `title` — it names the plan and fixes its filename for good',
          );
        }
        /**
         * Composed against an EMPTY plan, and composed BEFORE `allocatePath`.
         *
         * Only `content` can succeed here: `edits` addresses sections that a
         * plan with no text does not have (`SECTION_NOT_FOUND`, whatever the
         * action), and `textEdits` looks for fragments that are not there
         * (`FIND_NOT_FOUND`). Both refusals have to happen before a filename is
         * reserved, or a rejected call would leave an orphan plan behind — the
         * same failure mode the `target: 'explicit'` mount was introduced to fix.
         */
        const composed = composePlanBody('', payload);
        const base = slugify(trimmedTitle) || 'plan';
        // v0.1.129 fix: the OUTER lock (keyed `thread:${threadId}`) only
        // serializes calls from the SAME thread — it does nothing when two
        // DIFFERENT threads race to create a first plan with the same title
        // at the same time, since they compute different outer lock keys and
        // would otherwise run allocatePath's collision search + the write
        // that reserves the winning candidate fully in parallel, racing on
        // the same filename. Nest a lock keyed by the actual contended
        // resource — the slug `base` every racing candidate is derived from —
        // so only genuinely colliding titles serialize; different titles
        // never look at the same candidates and proceed unblocked.
        const { planPath, version, plan, finalContent } = await this.withLock(`new-plan:${base}`, async () => {
          const allocated = await this.allocatePath(base);
          const injected = injectAnchors(composed.body);
          const frontmatter: PlanFrontmatter = {
            type: 'plan',
            title: trimmedTitle,
            created_at: new Date().toISOString(),
            created_by: changedBy,
            // 0.2.14: written EXPLICITLY at create time rather than left to the
            // read-side default, so a plan file states its own flag from the
            // first byte. Pre-0.2.14 files without the key still read `false`.
            applied: false,
          };
          const fullContent = matter.stringify(injected, frontmatter as Record<string, unknown>);
          const abs = this.absPath(allocated);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          this.deps.plansWatcher.suppress(allocated);
          await fs.writeFile(abs, fullContent, 'utf-8');
          await this.deps.pageVersions.recordVersion(
            allocated,
            'create',
            toFileChangedBy(changedBy),
            undefined,
            this.deps.plansSerializer,
            PLAN_ROOT_MARKER,
            changeSummary,
          );
          await this.deps.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, allocated);
          return {
            planPath: allocated,
            version: this.currentVersionFor(allocated),
            plan: await this.getByPath(allocated),
            finalContent: injected,
          };
        });
        this.deps.chatService.attachPlanToThread(threadId, planPath);
        this.deps.ws.broadcast({ kind: 'plan:updated', planPath, threadId, version, changedBy });
        return {
          plan,
          version,
          hash: plan.hash,
          results: buildPlanResults(payload, '', finalContent, composed),
        };
      }

      const current = await this.getByPath(existingPath);
      /**
       * 0.2.15 — the guard, enforced HERE rather than in each channel's schema.
       *
       * Two refusals, and they mean different things. A MISSING hash is a caller
       * that never armed the guard at all: `INVALID_ARGUMENT`, because no retry
       * of the same call can succeed — it has to go read the plan first. A
       * MISMATCHED hash is a caller that armed it correctly and lost the race:
       * `PLAN_CONFLICT` (409) carrying the current hash, which is exactly what
       * the retry needs.
       *
       * Note what this does NOT accept: a hash the implementation read for the
       * caller a moment ago. Substituting `current.hash` here would satisfy every
       * schema and every test while guarding nothing at all — the value has to
       * come from the caller's own earlier read to mean anything.
       *
       * 0.2.43 — the hash is of the WHOLE plan in all three variants, a batch
       * touching one section included. A guard narrowed to a subtree would let
       * two callers agree on a section while disagreeing about the file.
       */
      if (typeof expectedHash !== 'string' || expectedHash.length === 0) {
        throw new DomainError(
          'INVALID_ARGUMENT',
          'expectedHash is required when updating an existing plan',
          'read the plan first with get_plan and pass back its `hash`',
        );
      }
      if (expectedHash !== current.hash) {
        throw new ConflictError('PLAN_CONFLICT', 'plan changed since last read', current.hash);
      }
      const composed = composePlanBody(current.body, payload);
      const finalContent = injectAnchors(composed.body);
      const { version, plan } = await this.persist({
        planPath: existingPath,
        body: finalContent,
        frontmatter: current.frontmatter,
        changeSummary,
        changedBy,
      });
      this.deps.ws.broadcast({ kind: 'plan:updated', planPath: existingPath, threadId, version, changedBy });
      return {
        plan,
        version,
        hash: plan.hash,
        results: buildPlanResults(payload, current.body, finalContent, composed),
      };
    });
  }

  /**
   * The write tail every plan write shares: suppress the watcher, write, capture
   * ONE `file_version` row, re-index.
   *
   * One row per CALL, not per edit — a batch touching five sections is one
   * version carrying one `changeSummary`, because it is one act.
   */
  private async persist(args: {
    planPath: string;
    body: string;
    frontmatter: PlanFrontmatter;
    changeSummary?: string;
    changedBy: PlanChangedBy;
  }): Promise<{ version: number; plan: Plan }> {
    const fullContent = matter.stringify(args.body, args.frontmatter as Record<string, unknown>);
    return this.persistRaw({ ...args, fullContent });
  }

  /** {@link persist}, for a caller that already holds the full file bytes. */
  private async persistRaw(args: {
    planPath: string;
    fullContent: string;
    changeSummary?: string;
    changedBy: PlanChangedBy;
  }): Promise<{ version: number; plan: Plan }> {
    const abs = this.absPath(args.planPath);
    this.deps.plansWatcher.suppress(args.planPath);
    await fs.writeFile(abs, args.fullContent, 'utf-8');
    await this.deps.pageVersions.recordVersion(
      args.planPath,
      'update',
      toFileChangedBy(args.changedBy),
      undefined,
      this.deps.plansSerializer,
      PLAN_ROOT_MARKER,
      args.changeSummary,
    );
    await this.deps.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, args.planPath);
    return { version: this.currentVersionFor(args.planPath), plan: await this.getByPath(args.planPath) };
  }

  /**
   * The write path's "does this plan exist" check — `PLAN_NOT_FOUND`, and it
   * carries the plans of this project.
   *
   * A read answers a wrong path with the generic `NOT_FOUND`; a write is where
   * the caller is about to lose its edit to a typo, so the refusal names the
   * alternatives instead of leaving it to guess which of `list_plans`' paths it
   * meant.
   */
  private async requirePlan(planPath: string): Promise<Plan> {
    if (!(await this.deps.plansPages.exists(planPath))) {
      const known = this.listPlans().map((p) => p.path);
      throw new DomainError(
        'PLAN_NOT_FOUND',
        `plan '${planPath}' not found`,
        known.length > 0 ? `this project's plans: ${known.join(', ')}` : 'this project has no plans yet',
      );
    }
    return this.getByPath(planPath);
  }


  /**
   * The plan EDITOR's save — `PUT /api/artifacts/plan/:path/content`.
   *
   * 0.2.43 — this is the `content` variant, made by a user instead of an agent,
   * and it is no longer a code path of its own. The old action dictionary carried
   * a `user_edit` value for exactly this; that value is gone, because the
   * distinction it encoded is `changedBy`, not a different kind of write. What
   * stays here rather than moving into {@link update} is the two things the
   * editor's payload has and an agent's has not: FULL FILE bytes (frontmatter
   * included, hence the immutability check) and no thread to address the plan by.
   *
   * The write tail is {@link persistRaw} — the same one {@link update} uses — so
   * a save from the editor and a write from an agent capture the same kind of
   * `file_version` row and land through the same watcher suppression.
   */
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
      const { version } = await this.persistRaw({
        planPath: opts.path,
        fullContent: opts.content,
        changeSummary: opts.changeSummary,
        changedBy: opts.changedBy,
      });
      /**
       * 0.2.43 — `plan:updated` carrying `changedBy: 'user'`, where this used to
       * broadcast `plans:changed`.
       *
       * Same reason the narrower event was added in v0.1.129 (a body-only save
       * emits nothing from the frontmatter indexer, leaving every other viewer
       * silently stale) — but the editor's save is a plan write like any other,
       * so it publishes the event plan writes publish, and consumers stop having
       * to know which door a change came through. `threadId` is null: the editor
       * is not a thread, and naming whichever one attached last would be a
       * plausible-looking attribution that is simply false.
       */
      this.deps.ws.broadcast({
        kind: 'plan:updated',
        planPath: opts.path,
        threadId: null,
        version,
        changedBy: opts.changedBy,
      });
      return { newHash: hashContent(opts.content) };
    });
  }

  /**
   * Write the mutable frontmatter keys (`title`, `applied`) of a plan.
   *
   * 0.2.14 — two rules local to kind `plan`, both deliberate:
   *
   *  - **No `recordVersion`.** A frontmatter-only write does NOT capture a
   *    `file_version` row, so `currentVersion`, `list_plan_versions` and the
   *    Version history panel are unchanged by flipping `applied` or renaming
   *    the plan. Brief and patch still capture every frontmatter write — this
   *    is not a family-wide rule.
   *  - **`plan:updated` is still emitted**, so the `/plans` list and the detail
   *    header refresh their badge without a reload. `version` carries the
   *    SAME value as before the write, which follows from the rule above — a
   *    consumer must not infer a new version from having received the event.
   *
   * 0.2.15 — `threadId` is passed IN, never derived here. See
   * {@link PlanUpdateFrontmatterOpts.threadId}: `mark_plan_applied` supplies the
   * calling thread, the generic REST frontmatter route supplies `null`.
   * Consumers key cache invalidation off `planPath` regardless.
   */
  async updateFrontmatter(opts: PlanUpdateFrontmatterOpts): Promise<Plan> {
    return this.withLock(opts.path, async () => {
      const current = await this.getByPath(opts.path);
      const next: PlanFrontmatter = { ...current.frontmatter };
      if (opts.patch.title !== undefined && opts.patch.title !== current.frontmatter.title) {
        next.title = opts.patch.title;
      }
      if (opts.patch.applied !== undefined && opts.patch.applied !== (current.frontmatter.applied === true)) {
        next.applied = opts.patch.applied;
      }
      const newContent = matter.stringify(current.body, next as Record<string, unknown>);
      const abs = this.absPath(opts.path);
      this.deps.plansWatcher.suppress(opts.path);
      await fs.writeFile(abs, newContent, 'utf-8');
      await this.deps.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, opts.path);
      const updated = await this.getByPath(opts.path);
      this.deps.ws.broadcast({
        kind: 'plan:updated',
        planPath: opts.path,
        threadId: opts.threadId,
        version: updated.currentVersion,
        changedBy: opts.changedBy,
      });
      return updated;
    });
  }

  /**
   * `mark_plan_applied` — declare the plan of `threadId` applied to the spec.
   *
   * Deliberately a separate operation rather than a parameter of `update_plan`:
   * declaring a plan applied is a different act from writing its content, and
   * the two undo in opposite directions (content is edited by whoever, the flag
   * is unset only by the user).
   *
   * ONE-WAY from this channel. `applied: false` is refused — the agent that
   * just executed a plan is the right party to say "done", and nobody in that
   * position is the right party to say "actually, not done"; that is the user's
   * call in the header of `/plans/:slug`.
   *
   * Idempotent: a repeat at the same value writes no file and emits no event.
   */
  async setAppliedByThread(
    threadId: string,
    input: PlanSetAppliedInput,
  ): Promise<{ path: string; applied: boolean }> {
    if (typeof input.applied !== 'boolean') {
      throw new DomainError('VALIDATION', 'applied is required and must be a boolean');
    }
    if (input.applied === false) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        'this tool only marks a plan applied; it cannot unmark one',
        'unset it in the UI — the toggle in the header of the plan page',
      );
    }
    const planPath = input.path ?? this.deps.chatService.getThreadPlanPath(threadId);
    if (!planPath) {
      throw new DomainError(
        'NOT_FOUND',
        'this thread has no plan to mark applied',
        'create one with update_plan (title required on the first call), or pass an explicit path',
      );
    }
    const current = await this.getByPath(planPath);
    // No-op on a repeat: no write, no version, no event.
    if ((current.frontmatter.applied === true) === input.applied) {
      return { path: planPath, applied: input.applied };
    }
    // The caller's own thread: `mark_plan_applied` is always made from one.
    await this.updateFrontmatter({
      path: planPath,
      patch: { applied: input.applied },
      changedBy: 'agent',
      threadId,
    });
    return { path: planPath, applied: input.applied };
  }

  // 0.1.138: `execute(planPath, mode)` is GONE. PlanService carries only plan
  // logic now (upsert-by-title + attach); "running" a plan is `attachThreadToPlan`
  // plus a client-side composer draft, so nothing here generates a first message
  // or touches `chat_thread.plan_mode` — that flag moves only through
  // `PATCH /api/threads/:id` / `POST /api/chat` (Plan Mode in ModelSettingsPopover).

  // ─── Internals ──────────────────────────────────────────────────────────

  private absPath(relPath: string): string {
    return path.join(this.deps.plansPages.root, relPath);
  }

  private currentVersionFor(planPath: string): number {
    return this.deps.pageVersions.getLatestForPath(planPath, undefined, PLAN_ROOT_MARKER)?.version ?? 0;
  }

  /** `base` is the already-slugified filename stem (caller computes it — see
   *  the `withLock('new-plan:' + base, ...)` call site, which needs the same
   *  value to key its lock). */
  private async allocatePath(base: string): Promise<string> {
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

/**
 * The plan body this call wants, composed in memory from the body it has.
 *
 * One function for the three variants, so the difference between them is
 * visible in ten lines rather than spread over the service. The `edits` case is
 * the batch engine in `plan-write.ts`; the other two are the whole plan, which
 * is why their scope maps come back empty.
 */
function composePlanBody(prior: string, payload: PlanEditPayload): ComposedPlanBody {
  switch (payload.variant) {
    case 'content':
      return { body: payload.content, scopeOf: new Map(), replacementsOf: new Map() };
    case 'textEdits': {
      /**
       * Counted over the WHOLE plan — the scope trap worth remembering. The same
       * patterns inside an `edits[]` entry are counted over that section's
       * subtree alone, so one pattern can be a legal single match in one variant
       * and a `MATCH_COUNT_MISMATCH` in the other.
       */
      const applied = applyTextEdits(prior, payload.textEdits);
      return {
        body: applied.text,
        scopeOf: new Map(),
        replacementsOf: new Map(),
        replacements: applied.replacements,
      };
    }
    case 'edits': {
      const outcome = applyPlanBatch(prior, payload.edits);
      return { body: outcome.body, scopeOf: outcome.scopeOf, replacementsOf: outcome.replacementsOf };
    }
  }
}

/**
 * `results[]` — one row per edit given, or one row for the whole plan.
 *
 * `affectedAnchors` is the anchor delta of the whole write, filtered of the row's
 * own anchor: attributing a change to the individual edit that caused it is not
 * possible after the fact (the edits share a file and their effects overlap), and
 * pretending otherwise would be a more confident answer than the data supports.
 *
 * `droppedAnchors` IS attributable, because each one is measured inside the single
 * range that edit overwrote — and it is reported on SUCCESS, not only on refusal:
 * a `replace` on a `##` section carrying three `###` children takes all four
 * anchors with it, and the caller has no other way to learn that.
 */
function buildPlanResults(
  payload: PlanEditPayload,
  priorBody: string,
  finalBody: string,
  composed: ComposedPlanBody,
): PlanEditResult[] {
  const affected = anchorDelta(sectionDigests(priorBody), sectionDigests(finalBody));
  const survivors = new Set(sectionRanges(finalBody.split('\n')).map((r) => r.anchor));

  if (payload.variant !== 'edits') {
    return [
      {
        /** No section was addressed — the variant's scope IS the plan. */
        anchor: null,
        /** No section action either — see {@link PlanEditResult.action}. */
        action: null,
        affectedAnchors: affected,
        droppedAnchors: sectionRanges(priorBody.split('\n'))
          .map((r) => r.anchor)
          .filter((a) => !survivors.has(a)),
        ...(payload.variant === 'textEdits' ? { replacements: composed.replacements ?? 0 } : {}),
      },
    ];
  }

  return payload.edits.map((edit) => ({
    anchor: edit.anchor,
    action: edit.action,
    affectedAnchors: affected.filter((a) => a !== edit.anchor),
    droppedAnchors: (composed.scopeOf.get(edit.anchor) ?? []).filter((a) => !survivors.has(a)),
    ...(edit.action === 'edit' ? { replacements: composed.replacementsOf.get(edit.anchor) ?? 0 } : {}),
  }));
}

/**
 * Mint an anchor that is free WITHIN THIS PLAN FILE. The uniqueness scope of a plan
 * anchor is the file it lives in — never `section_index`, which indexes page roots and
 * which plans are deliberately absent from. Colliding with a page's anchor is therefore
 * not a collision at all: `update_plan` resolves anchors only inside
 * `chat_thread.plan_path`, and page-side references resolve only through `section_index`.
 *
 * Bounded like the section indexer's mint loop: with 36^8 values a repeat is already
 * vanishingly unlikely, so exhausting the attempts means something is wrong, not unlucky.
 */
function mintPlanAnchor(taken: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = nanoid8();
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error('[plan] could not mint a free anchor in 8 attempts');
}

/**
 * M06 anchor injection for plans — ONE implementation, TWO triggers.
 *
 * `update_plan(action: insert_after_section)` must see anchors immediately after
 * the preceding write, with no debounce window, so `PlanService.update` calls
 * this synchronously. For writes that bypass `PlanService` entirely (an agent or
 * user editing a plan file on disk) the same function runs as the
 * `m06-plan-anchor-injection` write-back on the `artifacts:plan` source.
 *
 * Scope is unchanged either way: plans stay `sectionIndexed: false` and never
 * enter `section_index`, so plan anchors are unique within their file only.
 */
export function injectAnchors(content: string): string {
  const lines = content.split('\n');
  // Seed with every anchor already composed into this plan, so a value injected in this
  // pass can collide neither with an existing one nor with an earlier injection of the
  // same pass. Auto-injected anchors must never duplicate.
  const taken = new Set<string>();
  const scan = new RegExp(ANCHOR_PATTERN_SOURCE, 'g');
  for (const m of content.matchAll(scan)) taken.add(m[1]!);

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
    out.push(`<!-- anchor: ${mintPlanAnchor(taken)} -->`);
    out.push(line);
  }
  return out.join('\n');
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
