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

    expect(row(t.id, 'task1')).toMatchObject({ status: 'aborted', summary: 'first cycle done' });
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
