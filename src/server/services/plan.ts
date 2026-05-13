import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import type Database from 'better-sqlite3';
import type {
  BlameBlock,
  Plan,
  PlanAction,
  PlanChangedBy,
  PlanExecuteMode,
  PlanExecuteResult,
  PlanListItem,
  PlanVersion,
  PlanVersionMeta,
} from '../../shared/entities.js';
import { ANCHOR_PATTERN_SOURCE } from '../../shared/anchor-pattern.js';
import type { WsGateway } from '../ws/gateway.js';
import type { ChatService } from './chat.js';
import { DomainError } from './tags.js';

// Generator stays strict 8 (per M06 spec `15u7sazr` — auto-inject contract).
const nanoid8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const PLAN_HEADING_RE = /^(#{2,4})\s+(.+?)\s*$/;

interface PlanRow {
  id: number;
  title: string | null;
  content: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

interface PlanVersionRow {
  id: number;
  plan_id: number;
  version: number;
  content: string;
  action: string;
  action_params: string | null;
  change_summary: string | null;
  changed_by: string;
  created_at: string;
}

interface PlanListRow extends PlanRow {
  thread_count: number;
  last_thread_id: string | null;
}

export interface PlanUpdateInput {
  threadId: string;
  action: PlanAction;
  content: string;
  anchor?: string;
  heading?: string;
  changeSummary?: string;
  changedBy: PlanChangedBy;
  actionParams?: Record<string, unknown>;
}

export interface PlanUpdateResult {
  plan: Plan;
  version: number;
}

export class PlanService {
  constructor(
    private db: Database.Database,
    private ws: WsGateway,
    private chat: ChatService
  ) {}

  getByThread(threadId: string): Plan | null {
    const row = this.db
      .prepare(
        `SELECT p.*
           FROM plan p
           JOIN chat_thread t ON t.plan_id = p.id
          WHERE t.id = ?`
      )
      .get(threadId) as PlanRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  getById(planId: number): Plan {
    const row = this.db.prepare(`SELECT * FROM plan WHERE id = ?`).get(planId) as
      | PlanRow
      | undefined;
    if (!row) throw new DomainError('NOT_FOUND', `plan ${planId} not found`);
    return this.hydrate(row);
  }

  threadCount(planId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM chat_thread WHERE plan_id = ?`)
      .get(planId) as { n: number };
    return row.n;
  }

  listPlans(opts: { limit?: number; offset?: number; search?: string } = {}): {
    plans: PlanListItem[];
    total: number;
  } {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const search = opts.search?.trim();

    const where = search
      ? `WHERE p.title LIKE ? OR p.content LIKE ?`
      : '';
    const params: (string | number)[] = [];
    if (search) {
      const like = `%${search}%`;
      params.push(like, like);
    }

    const total = (this.db
      .prepare(`SELECT COUNT(*) AS n FROM plan p ${where}`)
      .get(...params) as { n: number }).n;

    const rows = this.db
      .prepare(
        `SELECT p.*,
                COUNT(t.id) AS thread_count,
                (SELECT id FROM chat_thread
                  WHERE plan_id = p.id
                  ORDER BY updated_at DESC
                  LIMIT 1) AS last_thread_id
           FROM plan p
           LEFT JOIN chat_thread t ON t.plan_id = p.id
           ${where}
          GROUP BY p.id
          ORDER BY p.updated_at DESC
          LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as PlanListRow[];

    const plans = rows.map((r) => ({
      id: r.id,
      title: r.title,
      currentVersion: r.current_version,
      threadCount: r.thread_count,
      lastThreadId: r.last_thread_id,
      updatedAt: r.updated_at,
    }));

    return { plans, total };
  }

  attachThreadToPlan(planId: number): { threadId: string } {
    const plan = this.getById(planId);
    const newThread = this.chat.createThread(
      plan.title ?? plan.content.split('\n')[0]?.slice(0, 60) ?? null
    );
    this.db
      .prepare(
        `UPDATE chat_thread
            SET plan_id = ?,
                last_seen_plan_version = ?,
                updated_at = datetime('now')
          WHERE id = ?`
      )
      .run(plan.id, plan.currentVersion, newThread.id);
    return { threadId: newThread.id };
  }

  findLastThreadIdForPlan(planId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM chat_thread
          WHERE plan_id = ?
          ORDER BY updated_at DESC
          LIMIT 1`
      )
      .get(planId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  updatePlanTitle(planId: number, title: string | null): Plan {
    const trimmed = title?.trim() || null;
    const info = this.db
      .prepare(`UPDATE plan SET title = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(trimmed, planId);
    if (info.changes === 0) throw new DomainError('NOT_FOUND', `plan ${planId} not found`);
    const plan = this.getById(planId);
    this.ws.broadcast({
      kind: 'plan:updated',
      planId,
      threadId: this.findLastThreadIdForPlan(planId) ?? '',
      version: plan.currentVersion,
      changedBy: 'user',
    });
    return plan;
  }

  markPlanSeenByThread(threadId: string): void {
    this.db
      .prepare(
        `UPDATE chat_thread
            SET last_seen_plan_version = (
              SELECT current_version FROM plan WHERE id = chat_thread.plan_id
            )
          WHERE id = ?
            AND plan_id IS NOT NULL`
      )
      .run(threadId);
  }

  /** Returns the `<system-reminder>` block to prepend to user message when plan is stale, or null. */
  getStalePlanReminder(threadId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT t.last_seen_plan_version AS last_seen,
                p.current_version       AS current_version
           FROM chat_thread t
           JOIN plan p ON p.id = t.plan_id
          WHERE t.id = ?`
      )
      .get(threadId) as { last_seen: number | null; current_version: number } | undefined;
    if (!row) return null;
    const lastSeen = row.last_seen;
    if (lastSeen === null) return null;
    if (row.current_version <= lastSeen) return null;
    return [
      '<system-reminder>',
      'Plan został zaktualizowany w innym wątku.',
      `Ostatnia wersja widziana w tym wątku: v${lastSeen}.`,
      `Aktualna wersja: v${row.current_version}.`,
      'Wykonaj get_plan, aby pobrać aktualny plan przed dalszą pracą.',
      '</system-reminder>',
    ].join('\n');
  }

  update(input: PlanUpdateInput): PlanUpdateResult {
    const {
      threadId,
      action,
      content,
      anchor,
      heading,
      changeSummary,
      changedBy,
      actionParams,
    } = input;

    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT p.*
             FROM plan p
             JOIN chat_thread t ON t.plan_id = p.id
            WHERE t.id = ?`
        )
        .get(threadId) as PlanRow | undefined;

      const priorContent = existing?.content ?? '';
      const newContent = composeContent(
        priorContent,
        action,
        content,
        anchor,
        heading
      );
      const finalContent = injectAnchors(newContent);

      let planId: number;
      if (!existing) {
        const info = this.db
          .prepare(
            `INSERT INTO plan (title, content, current_version, updated_at)
             VALUES (NULL, ?, 1, datetime('now'))`
          )
          .run(finalContent);
        planId = Number(info.lastInsertRowid);
        this.db
          .prepare(
            `UPDATE chat_thread
                SET plan_id = ?,
                    updated_at = datetime('now')
              WHERE id = ?`
          )
          .run(planId, threadId);
      } else {
        planId = existing.id;
        this.db
          .prepare(
            `UPDATE plan
                SET content = ?,
                    current_version = current_version + 1,
                    updated_at = datetime('now')
              WHERE id = ?`
          )
          .run(finalContent, planId);
      }

      const row = this.db
        .prepare(`SELECT * FROM plan WHERE id = ?`)
        .get(planId) as PlanRow;

      const version = row.current_version;
      this.db
        .prepare(
          `INSERT INTO plan_version
             (plan_id, version, content, action, action_params, change_summary, changed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          planId,
          version,
          finalContent,
          action,
          actionParams ? JSON.stringify(actionParams) : null,
          changeSummary ?? null,
          changedBy
        );

      this.db
        .prepare(
          `UPDATE chat_thread
              SET last_seen_plan_version = ?
            WHERE id = ?`
        )
        .run(version, threadId);

      return { plan: this.hydrate(row), version };
    });

    // BEGIN IMMEDIATE — anti-race przy konkurencyjnych edycjach z roznych watkow.
    const result = tx.immediate();

    this.ws.broadcast({
      kind: 'plan:updated',
      planId: result.plan.id,
      threadId,
      version: result.version,
      changedBy,
    });

    return result;
  }

  listVersions(
    planId: number,
    opts: { limit?: number; offset?: number } = {}
  ): { versions: PlanVersionMeta[]; total: number } {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const total = (this.db
      .prepare(`SELECT COUNT(*) AS n FROM plan_version WHERE plan_id = ?`)
      .get(planId) as { n: number }).n;
    const rows = this.db
      .prepare(
        `SELECT * FROM plan_version
          WHERE plan_id = ?
          ORDER BY version ASC
          LIMIT ? OFFSET ?`
      )
      .all(planId, limit, offset) as PlanVersionRow[];
    return {
      versions: rows.map((r) => this.hydrateVersionMeta(r)),
      total,
    };
  }

  getVersion(planId: number, version: number): PlanVersion {
    const row = this.db
      .prepare(`SELECT * FROM plan_version WHERE plan_id = ? AND version = ?`)
      .get(planId, version) as PlanVersionRow | undefined;
    if (!row) {
      throw new DomainError(
        'VERSION_NOT_FOUND',
        `plan ${planId} version ${version} not found`
      );
    }
    return this.hydrateVersion(row);
  }

  blame(planId: number): BlameBlock[] {
    const plan = this.getById(planId);
    const versions = this.db
      .prepare(
        `SELECT version, content FROM plan_version
          WHERE plan_id = ?
          ORDER BY version ASC`
      )
      .all(planId) as Array<{ version: number; content: string }>;

    const firstSeen = new Map<string, number>();
    for (const v of versions) {
      const blocks = splitBlocks(v.content);
      for (const block of blocks) {
        const hash = hashBlock(block);
        if (!firstSeen.has(hash)) firstSeen.set(hash, v.version);
      }
    }

    const currentBlocks = splitBlocks(plan.content);
    return currentBlocks.map((block, idx) => ({
      blockIndex: idx,
      markdownFragment: block,
      addedInVersion: firstSeen.get(hashBlock(block)) ?? plan.currentVersion,
    }));
  }

  execute(
    planId: number,
    mode: PlanExecuteMode,
    opts: { threadId?: string } = {}
  ): PlanExecuteResult {
    const plan = this.getById(planId);
    if (plan.content.trim().length === 0) {
      throw new DomainError('VALIDATION', 'cannot execute an empty plan');
    }

    if (mode === 'new-session') {
      const { threadId: newThreadId } = this.attachThreadToPlan(plan.id);
      this.chat.updateThreadSettings(newThreadId, { planMode: false });
      const firstMessage = `Wykonuje plan v${plan.currentVersion} — wyłaczam planMode i prosze o realizacje.`;
      return {
        mode: 'new-session',
        newThreadId,
        planId: plan.id,
        firstMessage,
      };
    }

    // mode === 'continue'
    const threadId = opts.threadId;
    if (!threadId) {
      throw new DomainError(
        'VALIDATION',
        "mode='continue' requires `threadId` in body"
      );
    }
    const attached = this.db
      .prepare(`SELECT plan_id FROM chat_thread WHERE id = ?`)
      .get(threadId) as { plan_id: number | null } | undefined;
    if (!attached) {
      throw new DomainError('NOT_FOUND', `thread '${threadId}' not found`);
    }
    if (attached.plan_id !== plan.id) {
      throw new DomainError(
        'THREAD_NOT_ATTACHED_TO_PLAN',
        `thread '${threadId}' is not attached to plan ${plan.id}`
      );
    }

    this.db
      .prepare(`UPDATE chat_thread SET plan_mode = 0, updated_at = datetime('now') WHERE id = ?`)
      .run(threadId);

    const firstMessage = `Wykonuje plan v${plan.currentVersion} — wyłaczam planMode i prosze o realizacje.`;

    return {
      mode: 'continue',
      threadId,
      firstMessage,
    };
  }

  private hydrate(row: PlanRow): Plan {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      currentVersion: row.current_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateVersion(row: PlanVersionRow): PlanVersion {
    return {
      id: row.id,
      planId: row.plan_id,
      version: row.version,
      content: row.content,
      action: row.action as PlanAction,
      actionParams: parseJson(row.action_params),
      changeSummary: row.change_summary,
      changedBy: row.changed_by as PlanChangedBy,
      createdAt: row.created_at,
    };
  }

  private hydrateVersionMeta(row: PlanVersionRow): PlanVersionMeta {
    return {
      version: row.version,
      action: row.action as PlanAction,
      actionParams: parseJson(row.action_params),
      changeSummary: row.change_summary,
      changedBy: row.changed_by as PlanChangedBy,
      createdAt: row.created_at,
    };
  }
}

function composeContent(
  prior: string,
  action: PlanAction,
  input: string,
  anchor?: string,
  heading?: string
): string {
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
        throw new DomainError(
          'MISSING_TARGET',
          'insert_after_section requires anchor or heading'
        );
      }
      return insertAfterSection(prior, input, anchor, heading);
    }
  }
}

function insertAfterSection(
  prior: string,
  fragment: string,
  anchor?: string,
  heading?: string
): string {
  const lines = prior.split('\n');

  // Znajdz linie naglowka docelowego + jego poziom.
  let targetLine = -1;
  let targetLevel = -1;
  const matches: Array<{ line: number; level: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(PLAN_HEADING_RE);
    if (!m) continue;
    const level = m[1]!.length;
    const text = m[2]!.trim();

    // Preferuj anchor (stabilny).
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
      throw new DomainError(
        'SECTION_NOT_FOUND',
        `section with heading "${heading}" not found`
      );
    }
    if (matches.length > 1) {
      throw new DomainError(
        'AMBIGUOUS_HEADING',
        `heading "${heading}" matches ${matches.length} sections`
      );
    }
    targetLine = matches[0]!.line;
    targetLevel = matches[0]!.level;
  }

  if (targetLine === -1) {
    throw new DomainError(
      'SECTION_NOT_FOUND',
      anchor
        ? `section with anchor "${anchor}" not found`
        : `section not found`
    );
  }

  // Znajdz koniec ciala sekcji: pierwszy nast. naglowek <= targetLevel, albo EOF.
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

function splitBlocks(content: string): string[] {
  if (!content) return [];
  return content
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function hashBlock(block: string): string {
  const normalized = block.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
