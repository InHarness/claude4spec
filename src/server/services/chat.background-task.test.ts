import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from './chat.js';

/**
 * 0.2.52: `chat_background_task` at the SQL level.
 *
 * The turn-level cases in `routes/agent-turn.test.ts` run against a STUBBED
 * `chatService`, so until this file nothing ever executed a statement against
 * this table. That left the two properties the brief calls out — the `ON DELETE
 * CASCADE` and the orphan finalizer — resting entirely on unexercised DDL.
 *
 * The finalizer matters more than it looks: a row left in `'running'` does not
 * merely lose information after F5, it renders something FALSE — a task that
 * died minutes ago still showing as in flight. Persistence without closing-out
 * starts lying.
 */
describe('ChatService — chat_background_task persistence', () => {
  let db: Database.Database;
  let chat: ChatService;

  const row = (threadId: string, taskId: string) =>
    db
      .prepare(`SELECT * FROM chat_background_task WHERE thread_id = ? AND task_id = ?`)
      .get(threadId, taskId) as Record<string, unknown> | undefined;

  const runningCount = (): number =>
    (
      db.prepare(`SELECT COUNT(*) AS n FROM chat_background_task WHERE status = 'running'`).get() as {
        n: number;
      }
    ).n;

  beforeEach(() => {
    db = new Database(':memory:');
    // better-sqlite3 defaults `foreign_keys` OFF; production turns it ON when it
    // opens the handle (`db/index.ts`). The cascade case below is meaningless
    // without it, so mirror production here rather than testing a no-op.
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    chat = new ChatService(db);
  });

  afterEach(() => db.close());

  it('seeds status=running on start — the event itself carries no status', () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bg1', 'shell', 'npm run build');

    expect(row(t.id, 'bg1')).toMatchObject({
      task_type: 'shell',
      description: 'npm run build',
      status: 'running',
      output_file: null,
      summary: null,
    });
  });

  it('re-arms a reused taskId that a previous turn left settled', () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bash_1', 'shell', 'old build');
    chat.updateBackgroundTaskProgress(t.id, 'bash_1', 'shell', null, null, '/tmp/old.log');
    chat.finalizeRunningBackgroundTasks(t.id);
    expect(row(t.id, 'bash_1')).toMatchObject({ status: 'abandoned' });

    // Engine task ids are session-scoped and restart, so the same id comes back
    // for a genuinely new task. The row must read as live again, carrying none
    // of the previous task's outcome.
    chat.startBackgroundTask(t.id, 'bash_1', 'shell', 'new build');

    expect(row(t.id, 'bash_1')).toMatchObject({
      description: 'new build',
      status: 'running',
      output_file: null,
      summary: null,
    });
  });

  it('keeps prior values for the fields a progress event omits (COALESCE)', () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bg1', 'shell', 'npm run build');
    chat.updateBackgroundTaskProgress(t.id, 'bg1', 'shell', 'compiling', null, '/tmp/bg1.log');
    // All three optional fields absent — nothing may be blanked out.
    chat.updateBackgroundTaskProgress(t.id, 'bg1', 'shell', null, null, null);

    expect(row(t.id, 'bg1')).toMatchObject({
      description: 'compiling',
      status: 'running',
      output_file: '/tmp/bg1.log',
    });
  });

  it('copies the completion status VERBATIM, with no normalization', () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bg1', 'shell', 'npm run build');
    chat.completeBackgroundTask(t.id, 'bg1', 'shell', 'exited 1', null, 'build failed');

    // Not mapped onto 'failed'/'error'/anything of ours: the contract types this
    // as a bare undocumented string, so classifying it would be inventing.
    expect(row(t.id, 'bg1')).toMatchObject({ status: 'exited 1', summary: 'build failed' });
  });

  it('keeps an output_file the completion event omits', () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bg1', 'shell', 'npm run build');
    chat.updateBackgroundTaskProgress(t.id, 'bg1', 'shell', null, null, '/tmp/bg1.log');
    chat.completeBackgroundTask(t.id, 'bg1', 'shell', 'success', null, null);

    expect(row(t.id, 'bg1')).toMatchObject({ status: 'success', output_file: '/tmp/bg1.log' });
  });

  it('lists a thread’s tasks in created_at order, scoped to that thread', () => {
    const a = chat.createThread('a');
    const b = chat.createThread('b');
    chat.startBackgroundTask(a.id, 'bg1', 'shell', 'first');
    chat.startBackgroundTask(a.id, 'bg2', 'monitor', 'second');
    chat.startBackgroundTask(b.id, 'other', 'workflow', 'elsewhere');
    // Same-second inserts: force a distinct ordering key rather than relying on
    // `datetime('now')`, whose resolution is one second. Backdated, not
    // post-dated, so created_at order is the REVERSE of insertion order — with a
    // `+1 hour` bump the two coincide and dropping the ORDER BY entirely would
    // still pass, since SQLite hands back rowid order.
    db.prepare(
      `UPDATE chat_background_task SET created_at = datetime('now', '-1 hour')
        WHERE thread_id = ? AND task_id = 'bg2'`,
    ).run(a.id);

    expect(chat.listBackgroundTasks(a.id).map((t) => t.taskId)).toEqual(['bg2', 'bg1']);
    expect(chat.listBackgroundTasks(b.id).map((t) => t.taskId)).toEqual(['other']);
  });

  it('keeps two parallel tasks of one turn as two rows, not one', () => {
    const t = chat.createThread('t');
    chat.startBackgroundTask(t.id, 'bg1', 'shell', 'build');
    chat.startBackgroundTask(t.id, 'bg2', 'monitor', 'watch');
    chat.completeBackgroundTask(t.id, 'bg1', 'shell', 'success', null, null);

    // `taskId` is the ONLY handle — the event family never carries a toolUseId,
    // so a collapse here would be unrecoverable on reload.
    const tasks = chat.listBackgroundTasks(t.id);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((x) => x.status).sort()).toEqual(['running', 'success']);
  });

  describe('orphan finalizer', () => {
    it('abandons only the running rows of the named thread', () => {
      const a = chat.createThread('a');
      const b = chat.createThread('b');
      chat.startBackgroundTask(a.id, 'live', 'shell', 'sleep 900');
      chat.startBackgroundTask(a.id, 'done', 'shell', 'build');
      chat.completeBackgroundTask(a.id, 'done', 'shell', 'success', null, null);
      chat.startBackgroundTask(b.id, 'untouched', 'monitor', 'watch');

      chat.finalizeRunningBackgroundTasks(a.id);

      expect(row(a.id, 'live')).toMatchObject({ status: 'abandoned' });
      // A settled row is not rewritten — 'abandoned' means "nobody closed this",
      // which is not the same as, and must not overwrite, a real outcome.
      expect(row(a.id, 'done')).toMatchObject({ status: 'success' });
      expect(row(b.id, 'untouched')).toMatchObject({ status: 'running' });
    });

    it('sweeps EVERY thread at once on the boot pass', () => {
      const a = chat.createThread('a');
      const b = chat.createThread('b');
      const c = chat.createThread('c');
      chat.startBackgroundTask(a.id, 'bg1', 'shell', 'x');
      chat.startBackgroundTask(b.id, 'bg1', 'monitor', 'y');
      chat.startBackgroundTask(c.id, 'bg1', 'workflow', 'z');
      chat.completeBackgroundTask(c.id, 'bg1', 'workflow', 'success', null, null);
      expect(runningCount()).toBe(2);

      // A restart orphans rows in every thread simultaneously, so the boot sweep
      // is deliberately unscoped — after it, nothing anywhere claims to be live.
      chat.finalizeAllRunningBackgroundTasks();

      expect(runningCount()).toBe(0);
      expect(row(a.id, 'bg1')).toMatchObject({ status: 'abandoned' });
      expect(row(b.id, 'bg1')).toMatchObject({ status: 'abandoned' });
      expect(row(c.id, 'bg1')).toMatchObject({ status: 'success' });
    });

    it('leaves chat_message rows alone — the two finalizers do not overlap', () => {
      const t = chat.createThread('t');
      const msg = chat.addMessage(t.id, 'assistant', JSON.stringify({ text: 'hi' }));
      db.prepare(`UPDATE chat_message SET status = 'streaming' WHERE id = ?`).run(msg.id);
      chat.startBackgroundTask(t.id, 'bg1', 'shell', 'x');
      // Both rows exist BEFORE either sweep runs. Creating bg2 afterwards would
      // make the assertion below tautological — a fresh row is 'running' whatever
      // the message finalizer did.
      chat.startBackgroundTask(t.id, 'bg2', 'shell', 'y');

      chat.finalizeRunningBackgroundTasks(t.id);
      const after = db.prepare(`SELECT status FROM chat_message WHERE id = ?`).get(msg.id) as {
        status: string;
      };
      expect(after.status).toBe('streaming');

      // bg2 was abandoned by the per-thread sweep above, so it cannot serve as
      // the witness here; re-open it and let the message finalizer run past it.
      chat.startBackgroundTask(t.id, 'bg2', 'shell', 'y');
      expect(row(t.id, 'bg2')).toMatchObject({ status: 'running' });
      chat.finalizeAllStreamingRows();
      // ...and the message finalizer likewise does not reach into this table.
      expect(row(t.id, 'bg2')).toMatchObject({ status: 'running' });
    });
  });

  it('cascades away with its thread, leaving no orphan row', () => {
    const a = chat.createThread('a');
    const b = chat.createThread('b');
    chat.startBackgroundTask(a.id, 'bg1', 'shell', 'x');
    chat.startBackgroundTask(a.id, 'bg2', 'monitor', 'y');
    chat.startBackgroundTask(b.id, 'bg1', 'shell', 'survivor');

    chat.deleteThread(a.id);

    // Retention has no time policy: rows leave ONLY with their thread, and when
    // it goes they must all go — a stray row keys on a thread_id nothing resolves.
    const left = db
      .prepare(`SELECT thread_id, task_id FROM chat_background_task`)
      .all() as { thread_id: string; task_id: string }[];
    expect(left).toEqual([{ thread_id: b.id, task_id: 'bg1' }]);
  });
});
