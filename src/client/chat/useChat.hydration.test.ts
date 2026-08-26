import { describe, it, expect } from 'vitest';
import { rowsToChatMessages, BACKGROUND_TASK_TOOL_NAME } from './useChat.js';
import type { ChatBackgroundTask, ChatMessage } from '../../shared/entities.js';

/**
 * BACKGROUND TASKS AFTER A COLD RELOAD (0.2.50).
 *
 * The panel moved from a flat list appended after the whole conversation to a
 * block inside the turn, placed by a synthetic carrier `tool_use`. That carrier
 * is produced by the live `onEvent` handler — and a cold load has no events.
 *
 * Background tasks live in `chat_background_task`, a SIBLING table with no
 * `chat_message` row, so unlike every other block they cannot be reached from
 * the row stream. Without an explicit pass here they render nowhere at all
 * after F5: the registry hydrates from the API and nothing references it. That
 * also silently defeats the persistence the spec settled on, and makes the
 * `'abandoned'` status written by the orphan finalizer unobservable.
 */
const row = (over: Partial<ChatMessage>): ChatMessage =>
  ({
    id: 1,
    threadId: 't1',
    role: 'assistant',
    content: JSON.stringify({ text: 'hello' }),
    toolName: null,
    toolId: null,
    subagentTaskId: null,
    planMode: false,
    status: 'complete',
    usage: null,
    contextSize: null,
    createdAt: '2026-08-26T10:00:00.000Z',
    ...over,
  }) as ChatMessage;

const task = (over: Partial<ChatBackgroundTask>): ChatBackgroundTask =>
  ({
    threadId: 't1',
    taskId: 'bg1',
    taskType: 'shell',
    description: 'sleep 5',
    status: 'success',
    outputFile: null,
    summary: 'slept',
    createdAt: '2026-08-26T10:00:01.000Z',
    updatedAt: '2026-08-26T10:00:06.000Z',
    ...over,
  }) as ChatBackgroundTask;

const carriers = (msgs: ReturnType<typeof rowsToChatMessages>) =>
  msgs.flatMap((m) =>
    m.blocks.filter(
      (b) => (b as { toolName?: string }).toolName === BACKGROUND_TASK_TOOL_NAME,
    ),
  );

describe('rowsToChatMessages — background-task carriers', () => {
  it('places a carrier block for a persisted background task', () => {
    const msgs = rowsToChatMessages(
      [row({ id: 1, role: 'user', content: JSON.stringify({ text: 'go' }) }), row({ id: 2 })],
      [],
      [task({})],
    );

    const found = carriers(msgs);
    expect(found).toHaveLength(1);
    // Same id shape the live branch produces, so the two paths render identically.
    expect((found[0] as { toolUseId: string }).toolUseId).toBe('bgtask-bg1');
    expect((found[0] as { input: { taskId: string } }).input.taskId).toBe('bg1');
  });

  it('anchors carriers by createdAt rather than dumping them at the end', () => {
    const msgs = rowsToChatMessages(
      [
        row({ id: 1, createdAt: '2026-08-26T10:00:00.000Z' }),
        row({ id: 2, createdAt: '2026-08-26T10:00:10.000Z' }),
      ],
      [],
      [task({ taskId: 'early', createdAt: '2026-08-26T10:00:01.000Z' })],
    );

    const blocks = msgs.flatMap((m) => m.blocks);
    const carrierAt = blocks.findIndex(
      (b) => (b as { toolName?: string }).toolName === BACKGROUND_TASK_TOOL_NAME,
    );
    // Between the two assistant blocks, not after both.
    expect(carrierAt).toBe(1);
    expect(blocks).toHaveLength(3);
  });

  it('places a carrier for a task that started after the last persisted row', () => {
    const msgs = rowsToChatMessages(
      [row({ id: 1, createdAt: '2026-08-26T10:00:00.000Z' })],
      [],
      [task({ taskId: 'late', createdAt: '2026-08-26T23:00:00.000Z' })],
    );

    expect(carriers(msgs)).toHaveLength(1);
  });

  it('emits one carrier per task and none when there are no background tasks', () => {
    expect(carriers(rowsToChatMessages([row({ id: 1 })], [], []))).toHaveLength(0);
    expect(
      carriers(
        rowsToChatMessages(
          [row({ id: 1 })],
          [],
          [task({ taskId: 'a' }), task({ taskId: 'b', createdAt: '2026-08-26T10:00:02.000Z' })],
        ),
      ),
    ).toHaveLength(2);
  });
});
