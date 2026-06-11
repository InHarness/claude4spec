import { describe, it, expect, vi } from 'vitest';

// 0.1.58: `answer` = the LAST assistant text block of the turn (final summary
// after the terminal `result`), not a concatenation of intermediate texts
// between tool calls. We drive the real runAgentTurn with a scripted event
// stream by mocking the adapter factory; everything else is a thin fake.
const hoisted = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    createAdapter: () => ({
      // eslint-disable-next-line require-yield
      execute: async function* execute() {
        for (const e of hoisted.events) yield e;
      },
    }),
  };
});

import { runAgentTurn, type AgentTurnDeps, type AgentTurnInput } from './agent-turn.js';

interface Recorded {
  role: string;
  text: string | null;
  toolName: string | null;
}

function makeDeps() {
  const messages: Recorded[] = [];
  let nextId = 1;
  const chatService = {
    addMessage: (_threadId: string, role: string, content: string, toolName: string | null = null) => {
      let text: string | null = null;
      try {
        text = JSON.parse(content).text ?? null;
      } catch {
        text = null;
      }
      messages.push({ role, text, toolName });
      return { id: nextId++ };
    },
    updateTitle: () => {},
    setInitialSystemPrompt: () => {},
    setInitialArchitectureConfig: () => {},
    setLastUsage: () => {},
    setLastSessionId: () => {},
    attachTurnUsage: () => {},
    setLastContextSize: () => {},
    attachTurnContextSize: () => {},
    markToolUseComplete: () => {},
    startSubagentTask: () => {},
    updateSubagentTaskProgress: () => {},
    completeSubagentTask: () => {},
    updateCurrentTodoItems: () => {},
    finalizeStreamingRows: () => {},
  };

  const deps = {
    pluginHost: {
      listEntities: () => [],
      computeEntityCounts: () => ({}),
      buildMcpServers: () => [],
    },
    activeAdapters: new Map(),
    pendingInputs: new Map(),
    chatService,
    pagesService: { read: async () => ({ body: '' }), listTree: async () => [] },
    tagsService: { list: () => [] },
    sectionsService: { count: () => 0 },
    planService: {
      getStalePlanReminder: () => null,
      getByThread: () => null,
      markPlanSeenByThread: () => {},
    },
    briefService: {},
    patchService: {},
    pageVersions: {},
    skillResolver: { resolve: () => [] },
    skillRegistry: { has: () => false },
    ws: {},
    cwd: process.cwd(),
    pagesDir: 'pages',
    mode: 'dev',
    db: { handle: {} },
  } as unknown as AgentTurnDeps;

  return { deps, messages };
}

function makeInput(): AgentTurnInput {
  return {
    thread: {
      id: 't1',
      planMode: false,
      contextType: 'chat',
      title: 'existing',
      hasSystemPrompt: false,
      lastSessionId: null,
      briefPath: null,
      patchPath: null,
    } as unknown as AgentTurnInput['thread'],
    prompt: 'hi',
    model: 'claude-opus-4-8' as unknown as AgentTurnInput['model'],
    architectureConfig: {},
    requestId: 'r1',
    consoleObserver: null,
    onEvent: () => {},
  };
}

describe('runAgentTurn — answer collapse (0.1.58)', () => {
  it('returns only the final assistant block; intermediate text is still persisted', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'Let me check that. ' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'u1', input: {} },
      { type: 'tool_result', toolUseId: 'u1', summary: 'ok', isError: false },
      { type: 'text_delta', text: 'Final summary of the answer.' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, messages } = makeDeps();
    const result = await runAgentTurn(deps, makeInput());

    // answer = last assistant block only (no concatenation of the pre-tool text).
    expect(result.answer).toBe('Final summary of the answer.');

    // Both assistant texts were persisted as separate chat_message rows — the
    // intermediate one is in history, just excluded from `answer`.
    const assistantTexts = messages.filter((m) => m.role === 'assistant').map((m) => m.text);
    expect(assistantTexts).toEqual(['Let me check that. ', 'Final summary of the answer.']);
  });

  it('handles multiple tool calls — answer is the trailing block after the last tool', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'First I read. ' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'u1', input: {} },
      { type: 'tool_result', toolUseId: 'u1', summary: 'a', isError: false },
      { type: 'text_delta', text: 'Now I grep. ' },
      { type: 'tool_use', toolName: 'Grep', toolUseId: 'u2', input: {} },
      { type: 'tool_result', toolUseId: 'u2', summary: 'b', isError: false },
      { type: 'text_delta', text: 'Done — here is the conclusion.' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const result = await runAgentTurn(deps, makeInput());
    expect(result.answer).toBe('Done — here is the conclusion.');
  });
});
