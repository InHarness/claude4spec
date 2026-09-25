import { describe, it, expect } from 'vitest';
import type { ChatMessage, TransagentChildRef } from '../../shared/entities.js';
import { reconstructTransagents, TRANSAGENT_TOOL_NAME } from './useChat.js';

/**
 * 0.2.111 (M46): after F5 a `runTransagent` panel resolves ONLY through the column
 * pair (`parent_thread_id` + `spawned_by_tool_use_id`). Every call — a continuation
 * included — founds its own child row, so each panel shows exactly the work its call
 * ordered. The old fallback to the `threadId` inside the tool_result is gone: for a
 * continuation it named the SAME banka as the spawn, and both panels rendered every
 * turn of that session.
 */
describe('reconstructTransagents (0.2.111)', () => {
  const toolUse = (toolId: string, contextType = 'chat'): ChatMessage =>
    ({
      role: 'tool_use',
      toolName: TRANSAGENT_TOOL_NAME,
      toolId,
      content: JSON.stringify({ input: { contextType, message: 'go' } }),
    }) as unknown as ChatMessage;
  const toolResult = (toolId: string, threadId: string, isError = false): ChatMessage =>
    ({
      role: 'tool_result',
      toolId,
      content: JSON.stringify({ summary: JSON.stringify({ threadId, summary: 's' }), isError }),
    }) as unknown as ChatMessage;

  it('[ac:ac-panel-wywolania-kontynuacyjnego-rende] resolves each call, spawn and continuation, to its own child row', () => {
    const rows = [
      toolUse('tu_spawn'),
      toolResult('tu_spawn', 'row_spawn'),
      toolUse('tu_cont'),
      toolResult('tu_cont', 'row_cont'),
    ];
    const children: TransagentChildRef[] = [
      { id: 'row_spawn', spawnedByToolUseId: 'tu_spawn', contextType: 'chat' },
      { id: 'row_cont', spawnedByToolUseId: 'tu_cont', contextType: 'chat' },
    ];

    expect(reconstructTransagents(rows, children)).toEqual([
      { toolUseId: 'tu_spawn', childThreadId: 'row_spawn', contextType: 'chat', status: 'completed' },
      { toolUseId: 'tu_cont', childThreadId: 'row_cont', contextType: 'chat', status: 'completed' },
    ]);
  });

  it('never borrows another call\'s row from the tool_result threadId', () => {
    // A call with no row of its own (a pre-0.2.111 continuation) whose result names
    // the spawn's row: it falls back to its plain tool card, not to a glued panel.
    const rows = [
      toolUse('tu_spawn'),
      toolResult('tu_spawn', 'row_spawn'),
      toolUse('tu_legacy'),
      toolResult('tu_legacy', 'row_spawn'),
    ];
    const children: TransagentChildRef[] = [
      { id: 'row_spawn', spawnedByToolUseId: 'tu_spawn', contextType: 'chat' },
    ];

    expect(reconstructTransagents(rows, children).map((e) => e.toolUseId)).toEqual(['tu_spawn']);
  });

  it('marks a failed call as error and leaves an in-flight call to the live replay', () => {
    const rows = [toolUse('tu_failed', 'patch'), toolResult('tu_failed', 'x', true), toolUse('tu_live')];
    const children: TransagentChildRef[] = [
      { id: 'row_failed', spawnedByToolUseId: 'tu_failed', contextType: 'patch' },
      { id: 'row_live', spawnedByToolUseId: 'tu_live', contextType: 'chat' },
    ];

    expect(reconstructTransagents(rows, children)).toEqual([
      { toolUseId: 'tu_failed', childThreadId: 'row_failed', contextType: 'patch', status: 'error' },
    ]);
  });
});
