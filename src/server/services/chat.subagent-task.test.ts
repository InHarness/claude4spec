import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from './chat.js';

/**
 * agent-adapters 0.9.12: `chat_subagent_task` under subagent RE-ENTRY.
 *
 * A subagent resumed through SendMessage emits a second `subagent_started`
 * (`resumed: true`) for the same task id, and only its LAST
 * `subagent_completed` ends it. The row has to follow: a resumption reads as
 * live again, the panel stays attached to the ORIGINAL `Task` card, and the
 * first cycle's description and report survive the re-entry.
 */
describe('ChatService — chat_subagent_task re-entry', () => {
  let db: Database.Database;
  let chat: ChatService;

  const row = (threadId: string, taskId: string) =>
    db
      .prepare(`SELECT * FROM chat_subagent_task WHERE thread_id = ? AND task_id = ?`)
      .get(threadId, taskId) as Record<string, unknown> | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
  });

  afterEach(() => db.close());

  it('seeds status=running on the first start', () => {
    const t = chat.createThread('t');
    chat.startSubagentTask(t.id, 'task1', 'explore the spec', 'tu_task');

    expect(row(t.id, 'task1')).toMatchObject({
      tool_use_id: 'tu_task',
      description: 'explore the spec',
      status: 'running',
      summary: null,
    });
  });

  it('a second start re-arms a completed task: running again, the first description and report kept', () => {
    const t = chat.createThread('t');
    chat.startSubagentTask(t.id, 'task1', 'explore the spec', 'tu_task');
    chat.completeSubagentTask(t.id, 'task1', 'completed', 'first cycle done');
    expect(row(t.id, 'task1')).toMatchObject({ status: 'completed', summary: 'first cycle done' });

    chat.startSubagentTask(t.id, 'task1', 'follow-up question', 'tu_sendmessage');

    expect(row(t.id, 'task1')).toMatchObject({
      description: 'explore the spec',
      status: 'running',
      summary: 'first cycle done',
    });

    chat.completeSubagentTask(t.id, 'task1', 'completed', 'second cycle done');
    expect(row(t.id, 'task1')).toMatchObject({ status: 'completed', summary: 'second cycle done' });
  });

  it('a re-entry that ends without a report does not erase the first cycle\'s', () => {
    const t = chat.createThread('t');
    chat.startSubagentTask(t.id, 'task1', 'explore the spec', 'tu_task');
    chat.completeSubagentTask(t.id, 'task1', 'completed', 'first cycle done');
    chat.startSubagentTask(t.id, 'task1', 'follow-up question', 'tu_sendmessage');
    chat.completeSubagentTask(t.id, 'task1', 'aborted', null);

    // 0.2.109: the library's `aborted` is stored as our `abandoned`.
    expect(row(t.id, 'task1')).toMatchObject({ status: 'abandoned', summary: 'first cycle done' });
  });

  it('keeps the FIRST tool_use_id, so the panel stays on the original Task card', () => {
    const t = chat.createThread('t');
    chat.startSubagentTask(t.id, 'task1', 'explore', 'tu_task');
    chat.startSubagentTask(t.id, 'task1', 'again', 'tu_sendmessage');

    expect(row(t.id, 'task1')?.tool_use_id).toBe('tu_task');
  });

  it('fills a missing tool_use_id from a later start', () => {
    const t = chat.createThread('t');
    chat.startSubagentTask(t.id, 'task1', 'explore', null);
    chat.startSubagentTask(t.id, 'task1', 'explore', 'tu_late');

    expect(row(t.id, 'task1')?.tool_use_id).toBe('tu_late');
  });
});

/**
 * 0.2.109: a delegation that never got `subagent_completed` (hold cap, abort,
 * timeout, restart) is closed as `abandoned` — per thread when its turn ends,
 * and across every thread at boot. Same shape as `chat_background_task`.
 */
describe('ChatService — abandoned delegations (0.2.109)', () => {
  let db: Database.Database;
  let chat: ChatService;

  const statuses = () =>
    db.prepare(`SELECT thread_id, task_id, status FROM chat_subagent_task ORDER BY task_id`).all() as Array<{
      thread_id: string;
      task_id: string;
      status: string;
    }>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
  });

  afterEach(() => db.close());

  it('the turn finalizer closes only this thread\'s running delegations', () => {
    const a = chat.createThread('a');
    const b = chat.createThread('b');
    chat.startSubagentTask(a.id, 's1', 'live', null);
    chat.startSubagentTask(a.id, 's2', 'done', null);
    chat.completeSubagentTask(a.id, 's2', 'completed', 'ok');
    chat.startSubagentTask(b.id, 's3', 'other thread', null);
    db.prepare(`UPDATE chat_subagent_task SET updated_at = '2000-01-01 00:00:00'`).run();

    chat.finalizeRunningSubagentTasks(a.id);

    expect(statuses()).toEqual([
      { thread_id: a.id, task_id: 's1', status: 'abandoned' },
      { thread_id: a.id, task_id: 's2', status: 'completed' },
      { thread_id: b.id, task_id: 's3', status: 'running' },
    ]);
    const s1 = db.prepare(`SELECT updated_at FROM chat_subagent_task WHERE task_id = 's1'`).get() as {
      updated_at: string;
    };
    expect(s1.updated_at).not.toBe('2000-01-01 00:00:00');
  });

  it('[ac:ac-po-restarcie-serwera-zaden-wiersz-cha] after a server restart no chat_subagent_task row stays running', () => {
    const a = chat.createThread('a');
    const b = chat.createThread('b');
    chat.startSubagentTask(a.id, 's1', 'x', null);
    chat.startSubagentTask(b.id, 's2', 'y', null);

    chat.finalizeAllRunningSubagentTasks();

    expect(statuses().map((r) => r.status)).toEqual(['abandoned', 'abandoned']);
  });

  it('never touches chat_background_task — a separate query', () => {
    const a = chat.createThread('a');
    chat.startBackgroundTask(a.id, 'bg1', 'shell', 'sleep');
    chat.startSubagentTask(a.id, 's1', 'x', null);

    chat.finalizeRunningSubagentTasks(a.id);

    const bg = db.prepare(`SELECT status FROM chat_background_task`).get() as { status: string };
    expect(bg.status).toBe('running');
  });

  it('validates the status enum: library completions map onto running|completed|failed|abandoned', () => {
    const a = chat.createThread('a');
    for (const [id, raw] of [
      ['c', 'completed'],
      ['f', 'failed'],
      ['e', 'error'],
      ['x', 'aborted'],
      ['y', 'stopped'],
    ] as const) {
      chat.startSubagentTask(a.id, id, id, null);
      chat.completeSubagentTask(a.id, id, raw, null);
    }
    expect(Object.fromEntries(chat.listSubagentTasks(a.id).map((t) => [t.taskId, t.status]))).toEqual({
      c: 'completed',
      f: 'failed',
      e: 'failed',
      x: 'abandoned',
      y: 'abandoned',
    });
  });

  it('hydrates a pre-0.2.109 raw status onto the enum', () => {
    const a = chat.createThread('a');
    chat.startSubagentTask(a.id, 's1', 'x', null);
    db.prepare(`UPDATE chat_subagent_task SET status = 'aborted'`).run();

    expect(chat.listSubagentTasks(a.id)[0]!.status).toBe('abandoned');
  });
});
