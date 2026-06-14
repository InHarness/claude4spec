import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  ChatContextType,
  ChatMessage,
  ChatMessageStatus,
  ChatRole,
  ChatSubagentTask,
  ChatThread,
  ChatThreadMeta,
  QueuedMessage,
  TodoItem,
  UsageStats,
} from '../../shared/entities.js';
import { DomainError } from './tags.js';

interface ChatThreadRow {
  id: string;
  title: string | null;
  last_session_id: string | null;
  initial_system_prompt: string | null;
  current_todo_items: string | null;
  plan_mode: number;
  last_usage_json: string | null;
  last_context_size: number | null;
  plan_id: number | null;
  last_seen_plan_version: number | null;
  has_system_prompt: number;
  context_type: string;
  brief_path: string | null;
  patch_path: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: number;
  thread_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_id: string | null;
  subagent_task_id: string | null;
  plan_mode: number;
  status: string;
  usage_json: string | null;
  context_size: number | null;
  created_at: string;
}

interface ChatSubagentTaskRow {
  thread_id: string;
  task_id: string;
  tool_use_id: string | null;
  description: string;
  status: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatQueuedMessageRow {
  id: number;
  thread_id: string;
  position: number;
  prompt: string;
  annotations_json: string | null;
  current_page: string | null;
  created_at: string;
}

/** A drained queue row — carries the full enqueue context for dispatch. */
export interface QueuedMessageRecord {
  id: string;
  prompt: string;
  annotationsJson: string | null;
  currentPage: string | null;
  createdAt: string;
}

/** Hard cap on pending queued messages per thread (→ 400 QUEUE_FULL). */
export const QUEUE_LIMIT = 20;

export class ChatService {
  constructor(private db: Database.Database) {}

  createThread(
    title: string | null = null,
    opts: {
      contextType?: ChatContextType;
      briefPath?: string | null;
      patchPath?: string | null;
    } = {},
  ): ChatThread {
    const id = nanoid(12);
    const contextType: ChatContextType = opts.contextType ?? 'chat';
    const briefPath = opts.briefPath ?? null;
    const patchPath = opts.patchPath ?? null;
    // Invariant L2: context_type='brief' ⇒ brief_path IS NOT NULL.
    if (contextType === 'brief' && !briefPath) {
      throw new DomainError('VALIDATION', "context_type='brief' requires brief_path");
    }
    // M23: context_type='patch' ⇒ patch_path IS NOT NULL.
    if (contextType === 'patch' && !patchPath) {
      throw new DomainError('VALIDATION', "context_type='patch' requires patch_path");
    }
    this.db
      .prepare(
        `INSERT INTO chat_thread (id, title, context_type, brief_path, patch_path)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, title, contextType, briefPath, patchPath);
    return this.getThreadRow(id);
  }

  /** M21: list threads attached to a brief (path-keyed lookup). */
  listThreadsForBrief(briefPath: string): ChatThreadMeta[] {
    const rows = this.db
      .prepare(
        `SELECT t.*,
                COUNT(m.id) AS message_count,
                (t.initial_system_prompt IS NOT NULL) AS has_system_prompt
           FROM chat_thread t
           LEFT JOIN chat_message m ON m.thread_id = t.id
          WHERE t.brief_path = ? AND t.context_type = 'brief'
          GROUP BY t.id
          ORDER BY t.updated_at DESC`,
      )
      .all(briefPath) as Array<ChatThreadRow & { message_count: number }>;
    return rows.map((r) => ({
      ...this.hydrateThread(r),
      messageCount: r.message_count,
    }));
  }

  /** M23: list threads attached to a patch (path-keyed lookup). */
  listThreadsForPatch(patchPath: string): ChatThreadMeta[] {
    const rows = this.db
      .prepare(
        `SELECT t.*,
                COUNT(m.id) AS message_count,
                (t.initial_system_prompt IS NOT NULL) AS has_system_prompt
           FROM chat_thread t
           LEFT JOIN chat_message m ON m.thread_id = t.id
          WHERE t.patch_path = ? AND t.context_type = 'patch'
          GROUP BY t.id
          ORDER BY t.updated_at DESC`,
      )
      .all(patchPath) as Array<ChatThreadRow & { message_count: number }>;
    return rows.map((r) => ({
      ...this.hydrateThread(r),
      messageCount: r.message_count,
    }));
  }

  /** M23: count threads for a patch (cheap version for list UI). */
  threadCountForPatch(patchPath: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM chat_thread WHERE patch_path = ? AND context_type = 'patch'`,
      )
      .get(patchPath) as { n: number };
    return row.n;
  }

  listThreads(): ChatThreadMeta[] {
    const rows = this.db
      .prepare(
        `SELECT t.*,
                COUNT(m.id) AS message_count,
                (t.initial_system_prompt IS NOT NULL) AS has_system_prompt
           FROM chat_thread t
           LEFT JOIN chat_message m ON m.thread_id = t.id
          GROUP BY t.id
          ORDER BY t.updated_at DESC`
      )
      .all() as Array<ChatThreadRow & { message_count: number }>;
    return rows.map((r) => ({
      ...this.hydrateThread(r),
      messageCount: r.message_count,
    }));
  }

  getThread(
    id: string,
    limit?: number,
    offset?: number
  ): { thread: ChatThread; messages: ChatMessage[]; subagentTasks: ChatSubagentTask[] } | null {
    const thread = this.findThread(id);
    if (!thread) return null;
    const messages = this.getMessages(id, limit, offset);
    const subagentTasks = this.listSubagentTasks(id);
    return { thread, messages, subagentTasks };
  }

  getThreadMeta(id: string): ChatThread | null {
    return this.findThread(id);
  }

  deleteThread(id: string): { deleted: true } {
    const info = this.db.prepare(`DELETE FROM chat_thread WHERE id = ?`).run(id);
    if (info.changes === 0) throw new DomainError('NOT_FOUND', `thread '${id}' not found`);
    return { deleted: true };
  }

  addMessage(
    threadId: string,
    role: ChatRole,
    content: string,
    toolName: string | null = null,
    toolId: string | null = null,
    subagentTaskId: string | null = null,
    planMode = false,
    status: ChatMessageStatus = 'complete'
  ): ChatMessage {
    const tx = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO chat_message (thread_id, role, content, tool_name, tool_id, subagent_task_id, plan_mode, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(threadId, role, content, toolName, toolId, subagentTaskId, planMode ? 1 : 0, status);
      this.db
        .prepare(`UPDATE chat_thread SET updated_at = datetime('now') WHERE id = ?`)
        .run(threadId);
      const row = this.db
        .prepare(`SELECT * FROM chat_message WHERE id = ?`)
        .get(info.lastInsertRowid) as ChatMessageRow;
      return this.hydrateMessage(row);
    });
    return tx();
  }

  startSubagentTask(
    threadId: string,
    taskId: string,
    description: string,
    toolUseId: string | null
  ): void {
    this.db
      .prepare(
        `INSERT INTO chat_subagent_task (thread_id, task_id, tool_use_id, description, status)
         VALUES (?, ?, ?, ?, 'running')
         ON CONFLICT(thread_id, task_id) DO UPDATE SET
           tool_use_id = COALESCE(excluded.tool_use_id, chat_subagent_task.tool_use_id),
           description = excluded.description,
           updated_at  = datetime('now')`
      )
      .run(threadId, taskId, toolUseId, description);
  }

  updateSubagentTaskProgress(threadId: string, taskId: string, description: string): void {
    this.db
      .prepare(
        `UPDATE chat_subagent_task
            SET description = ?, updated_at = datetime('now')
          WHERE thread_id = ? AND task_id = ?`
      )
      .run(description, threadId, taskId);
  }

  completeSubagentTask(
    threadId: string,
    taskId: string,
    status: string,
    summary: string | null
  ): void {
    this.db
      .prepare(
        `UPDATE chat_subagent_task
            SET status = ?, summary = ?, updated_at = datetime('now')
          WHERE thread_id = ? AND task_id = ?`
      )
      .run(status, summary, threadId, taskId);
  }

  listSubagentTasks(threadId: string): ChatSubagentTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_subagent_task
          WHERE thread_id = ?
          ORDER BY created_at ASC`
      )
      .all(threadId) as ChatSubagentTaskRow[];
    return rows.map((r) => this.hydrateSubagentTask(r));
  }

  getMessages(threadId: string, limit?: number, offset?: number): ChatMessage[] {
    const rows =
      limit === undefined
        ? (this.db
            .prepare(
              `SELECT * FROM chat_message
                WHERE thread_id = ?
                ORDER BY id ASC`
            )
            .all(threadId) as ChatMessageRow[])
        : (this.db
            .prepare(
              `SELECT * FROM chat_message
                WHERE thread_id = ?
                ORDER BY id ASC
                LIMIT ? OFFSET ?`
            )
            .all(threadId, limit, offset ?? 0) as ChatMessageRow[]);
    return rows.map((r) => this.hydrateMessage(r));
  }

  updateTitle(threadId: string, title: string): void {
    const info = this.db
      .prepare(`UPDATE chat_thread SET title = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(title, threadId);
    if (info.changes === 0) throw new DomainError('NOT_FOUND', `thread '${threadId}' not found`);
  }

  setLastSessionId(threadId: string, sessionId: string): void {
    this.db
      .prepare(`UPDATE chat_thread SET last_session_id = ? WHERE id = ?`)
      .run(sessionId, threadId);
  }

  setInitialSystemPrompt(threadId: string, prompt: string): void {
    this.db
      .prepare(
        `UPDATE chat_thread SET initial_system_prompt = ?
           WHERE id = ? AND initial_system_prompt IS NULL`
      )
      .run(prompt, threadId);
  }

  getInitialSystemPrompt(threadId: string): string | null {
    const row = this.db
      .prepare(`SELECT initial_system_prompt FROM chat_thread WHERE id = ?`)
      .get(threadId) as { initial_system_prompt: string | null } | undefined;
    return row?.initial_system_prompt ?? null;
  }

  /**
   * M05 session-lock: snapshot `{ model, architectureConfig }` z PIERWSZEJ tury.
   * Punkt odniesienia dla guarda `RESUME_CONFIG_LOCKED` — model i pola reasoningu
   * sa session-immutable. Idempotentny (UPDATE tylko gdy kolumna jest NULL), wiec
   * no-op na 2.+ turze. Wzorowane na `setInitialSystemPrompt`.
   */
  setInitialArchitectureConfig(
    threadId: string,
    snapshot: { model: string; architectureConfig: Record<string, unknown> },
  ): void {
    this.db
      .prepare(
        `UPDATE chat_thread SET initial_architecture_config_json = ?
           WHERE id = ? AND initial_architecture_config_json IS NULL`
      )
      .run(JSON.stringify(snapshot), threadId);
  }

  /** Debug-only — NIE w domyslnej projekcji GET /api/threads/:id (jak initial_system_prompt). */
  getInitialArchitectureConfig(threadId: string): string | null {
    const row = this.db
      .prepare(`SELECT initial_architecture_config_json FROM chat_thread WHERE id = ?`)
      .get(threadId) as { initial_architecture_config_json: string | null } | undefined;
    return row?.initial_architecture_config_json ?? null;
  }

  setLastUsage(threadId: string, usage: UsageStats): void {
    this.db
      .prepare(`UPDATE chat_thread SET last_usage_json = ? WHERE id = ?`)
      .run(JSON.stringify(usage), threadId);
  }

  attachTurnUsage(threadId: string, messageId: number, usage: UsageStats): void {
    this.db
      .prepare(
        `UPDATE chat_message SET usage_json = ? WHERE id = ? AND thread_id = ?`
      )
      .run(JSON.stringify(usage), messageId, threadId);
  }

  setLastContextSize(threadId: string, contextSize: number): void {
    this.db
      .prepare(`UPDATE chat_thread SET last_context_size = ? WHERE id = ?`)
      .run(contextSize, threadId);
  }

  attachTurnContextSize(threadId: string, messageId: number, contextSize: number): void {
    this.db
      .prepare(
        `UPDATE chat_message SET context_size = ? WHERE id = ? AND thread_id = ?`
      )
      .run(contextSize, messageId, threadId);
  }

  markToolUseComplete(threadId: string, toolUseId: string): void {
    this.db
      .prepare(
        `UPDATE chat_message SET status = 'complete'
           WHERE thread_id = ? AND tool_id = ? AND role = 'tool_use'`
      )
      .run(threadId, toolUseId);
  }

  finalizeStreamingRows(threadId: string): void {
    this.db
      .prepare(
        `UPDATE chat_message SET status = 'complete'
           WHERE thread_id = ? AND status = 'streaming'`
      )
      .run(threadId);
  }

  finalizeAllStreamingRows(): void {
    this.db
      .prepare(`UPDATE chat_message SET status = 'complete' WHERE status = 'streaming'`)
      .run();
  }

  updateCurrentTodoItems(threadId: string, items: TodoItem[] | null): void {
    const payload = items && items.length > 0 ? JSON.stringify(items) : null;
    this.db
      .prepare(`UPDATE chat_thread SET current_todo_items = ? WHERE id = ?`)
      .run(payload, threadId);
  }

  updateThreadSettings(threadId: string, patch: { planMode?: boolean }): ChatThread {
    if (patch.planMode !== undefined) {
      const info = this.db
        .prepare(
          `UPDATE chat_thread SET plan_mode = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .run(patch.planMode ? 1 : 0, threadId);
      if (info.changes === 0) throw new DomainError('NOT_FOUND', `thread '${threadId}' not found`);
    }
    return this.getThreadRow(threadId);
  }

  // --- M05: chat message queue ---------------------------------------------
  // A row lives from enqueue until delivery (mid-turn push or after-turn merged
  // dispatch) or cancellation. `position` is monotonic per thread.

  /** Pending queue size for a thread (for the QUEUE_LIMIT check). */
  countQueued(threadId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM chat_queued_message WHERE thread_id = ?`)
      .get(threadId) as { n: number };
    return row.n;
  }

  /** Append a message to a thread's queue. `position = MAX(position)+1`. */
  enqueueQueued(
    threadId: string,
    prompt: string,
    annotationsJson: string | null = null,
    currentPage: string | null = null,
  ): QueuedMessage {
    const info = this.db
      .prepare(
        `INSERT INTO chat_queued_message (thread_id, position, prompt, annotations_json, current_page)
         VALUES (
           ?,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM chat_queued_message WHERE thread_id = ?),
           ?, ?, ?
         )`,
      )
      .run(threadId, threadId, prompt, annotationsJson, currentPage);
    const row = this.db
      .prepare(`SELECT * FROM chat_queued_message WHERE id = ?`)
      .get(info.lastInsertRowid) as ChatQueuedMessageRow;
    return this.hydrateQueued(row);
  }

  /** Snapshot of a thread's queue in delivery order (`position ASC`). */
  listQueued(threadId: string): QueuedMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_queued_message WHERE thread_id = ? ORDER BY position ASC`,
      )
      .all(threadId) as ChatQueuedMessageRow[];
    return rows.map((r) => this.hydrateQueued(r));
  }

  /** Cancel a single queued message by `(thread_id, id)`. Returns false if gone. */
  removeQueued(threadId: string, id: string): boolean {
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) return false;
    const info = this.db
      .prepare(`DELETE FROM chat_queued_message WHERE thread_id = ? AND id = ?`)
      .run(threadId, numericId);
    return info.changes > 0;
  }

  /** Drain the whole queue (FIFO) in one transaction — select then delete. */
  popAllQueued(threadId: string): QueuedMessageRecord[] {
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM chat_queued_message WHERE thread_id = ? ORDER BY position ASC`,
        )
        .all(threadId) as ChatQueuedMessageRow[];
      if (rows.length > 0) {
        this.db.prepare(`DELETE FROM chat_queued_message WHERE thread_id = ?`).run(threadId);
      }
      return rows;
    });
    return tx().map((r) => ({
      id: String(r.id),
      prompt: r.prompt,
      annotationsJson: r.annotations_json,
      currentPage: r.current_page,
      createdAt: r.created_at,
    }));
  }

  /** Clear the whole queue, returning the dropped texts (`position ASC`). */
  clearQueued(threadId: string): string[] {
    return this.popAllQueued(threadId).map((r) => r.prompt);
  }

  private hydrateQueued(row: ChatQueuedMessageRow): QueuedMessage {
    return { id: String(row.id), text: row.prompt, createdAt: row.created_at };
  }

  private findThread(id: string): ChatThread | null {
    const row = this.db
      .prepare(
        `SELECT t.*,
                (t.initial_system_prompt IS NOT NULL) AS has_system_prompt
           FROM chat_thread t
          WHERE t.id = ?`
      )
      .get(id) as ChatThreadRow | undefined;
    return row ? this.hydrateThread(row) : null;
  }

  private getThreadRow(id: string): ChatThread {
    const thread = this.findThread(id);
    if (!thread) throw new Error(`thread ${id} disappeared mid-tx`);
    return thread;
  }

  private hydrateThread(row: ChatThreadRow): ChatThread {
    const usage = parseUsage(row.last_usage_json);
    // Backward-compat: stare wątki bez kolumny last_context_size — fallback do
    // usage.inputTokens + usage.outputTokens (mirror `contextSizeOf` z library).
    // Wątki migracja-uwsteczna: zawsze NULL → fallback. Po pierwszej turze post-024
    // server zapisze realny contextSize i fallback przestanie być potrzebny.
    const contextSize =
      row.last_context_size ?? (usage ? usage.inputTokens + usage.outputTokens : null);
    return {
      id: row.id,
      title: row.title,
      lastSessionId: row.last_session_id,
      currentTodoItems: parseTodoItems(row.current_todo_items),
      planMode: row.plan_mode === 1,
      usage,
      contextSize,
      planId: row.plan_id ?? null,
      lastSeenPlanVersion: row.last_seen_plan_version ?? null,
      hasSystemPrompt: row.has_system_prompt === 1,
      contextType: hydrateContextType(row.context_type),
      briefPath: row.brief_path,
      patchPath: row.patch_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateMessage(row: ChatMessageRow): ChatMessage {
    return {
      id: row.id,
      threadId: row.thread_id,
      role: row.role as ChatRole,
      content: row.content,
      toolName: row.tool_name,
      toolId: row.tool_id,
      subagentTaskId: row.subagent_task_id,
      planMode: row.plan_mode === 1,
      status: row.status === 'streaming' ? 'streaming' : 'complete',
      usage: parseUsage(row.usage_json),
      contextSize: row.context_size ?? null,
      createdAt: row.created_at,
    };
  }

  private hydrateSubagentTask(row: ChatSubagentTaskRow): ChatSubagentTask {
    return {
      threadId: row.thread_id,
      taskId: row.task_id,
      toolUseId: row.tool_use_id,
      description: row.description,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/** Map the raw `context_type` column to the typed discriminator. */
function hydrateContextType(raw: string): ChatContextType {
  return raw === 'brief' || raw === 'patch' ? raw : 'chat';
}

function parseTodoItems(raw: string | null): TodoItem[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TodoItem[]) : null;
  } catch {
    return null;
  }
}

function parseUsage(raw: string | null): UsageStats | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as UsageStats;
    return null;
  } catch {
    return null;
  }
}
