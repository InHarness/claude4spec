import { describe, it, expect, afterEach, vi } from 'vitest';
import type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';

/**
 * M05 `dhf17oo0` — the answer to the agent's question in a headless turn tells the
 * agent to act on its own recommendation.
 *
 * Drives the REAL `runAgentTurn` with the input the headless route builds
 * (`threads.ts` POST /:id/ask: the route's own decline handler, `headless`, the
 * prompt note). Only the adapter is faked: like the claude-code adapter, it calls
 * `onUserInput` for `AskUserQuestion` (`model-tool`) and for MCP elicitation
 * (`mcp-elicitation`) and records what the model is given — the prompt of every
 * query — since the adapter's decline itself carries no text (dev-0508).
 */
const TOOL_QUESTION = {
  requestId: 'q-tool',
  source: 'model-tool',
  origin: 'claude-code',
  questions: [{ question: 'Which module first?', options: [{ label: 'M05' }, { label: 'M53' }] }],
} as unknown as UserInputRequest;

const MCP_QUESTION = {
  requestId: 'q-mcp',
  source: 'mcp-elicitation',
  origin: 'c4s-spec',
  questions: [{ question: 'Confirm the slug?' }],
} as unknown as UserInputRequest;

const hoisted = vi.hoisted(() => ({
  executes: [] as Array<Record<string, unknown>>,
  answers: [] as unknown[],
}));

vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    createAdapter: () => ({
      execute: async function* execute(opts: Record<string, unknown>) {
        hoisted.executes.push(opts);
        const onUserInput = opts.onUserInput as ((r: UserInputRequest) => Promise<UserInputResponse>) | undefined;
        if (onUserInput) {
          for (const q of [TOOL_QUESTION, MCP_QUESTION]) hoisted.answers.push(await onUserInput(q));
        }
        yield { type: 'text_delta', text: 'Went with M05.' };
        yield { type: 'result', sessionId: 's1' };
      },
    }),
  };
});

import { runAgentTurn, type AgentTurnDeps, type AgentTurnInput } from './agent-turn.js';
import {
  createHeadlessUserInputHandler,
  HEADLESS_TURN_PROMPT_NOTE,
  HEADLESS_USER_INPUT_GUIDANCE,
} from './headless-user-input.js';

afterEach(() => {
  hoisted.executes = [];
  hoisted.answers = [];
});

function makeDeps() {
  const rows: Array<{ id: number; role: string; content: string; toolName: string | null; subagentTaskId: null }> = [];
  let nextId = 1;
  const chatService = {
    addMessage: (_threadId: string, role: string, content: string, toolName: string | null = null) => {
      const id = nextId++;
      rows.push({ id, role, content, toolName: toolName ?? null, subagentTaskId: null });
      return { id };
    },
    latestMessageId: () => rows.at(-1)?.id ?? 0,
    getMessages: () => rows,
    updateTitle: () => {},
    setInitialSystemPrompt: () => {},
    setInitialArchitectureConfig: () => {},
    getInitialArchitectureConfig: () => null,
    setLastUsage: () => {},
    setLastSessionId: () => {},
    recordSession: () => {},
    attachTurnUsage: () => {},
    setLastContextSize: () => {},
    attachTurnContextSize: () => {},
    markToolUseComplete: () => {},
    startSubagentTask: () => {},
    updateSubagentTaskProgress: () => {},
    completeSubagentTask: () => {},
    startBackgroundTask: () => {},
    updateBackgroundTaskProgress: () => {},
    completeBackgroundTask: () => {},
    finalizeRunningBackgroundTasks: () => {},
    finalizeRunningSubagentTasks: () => {},
    updateCurrentTodoItems: () => {},
    finalizeStreamingRows: () => {},
    popAllQueued: () => [],
  };
  const deps = {
    pluginHost: { listEntities: () => [], buildMcpServers: () => [] },
    activeAdapters: new Map(),
    pendingInputs: new Map(),
    chatService,
    pagesService: { rootId: 'pages', read: async () => ({ body: '' }), listTree: async () => [] },
    tagsService: { list: () => [] },
    sectionsService: { count: () => 0 },
    planService: { getByThread: async () => null },
    briefService: {},
    patchService: {},
    pageVersions: {},
    skillResolver: { resolve: () => [], resolveForContext: () => [] },
    skillRegistry: { has: () => false, resolve: () => { throw new Error('unexpected resolve() call'); } },
    ws: {},
    cwd: process.cwd(),
    roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
    mode: 'dev',
    db: { handle: {} },
  } as unknown as AgentTurnDeps;
  return { deps, rows, chatService };
}

const USER_MESSAGE = 'Which module first?';

function baseInput(): AgentTurnInput {
  return {
    thread: {
      id: 't1',
      planMode: false,
      contextType: 'ask',
      title: 'existing',
      hasSystemPrompt: false,
      lastSessionId: null,
      briefPath: null,
      patchPath: null,
    } as unknown as AgentTurnInput['thread'],
    prompt: USER_MESSAGE,
    model: 'claude-opus-5' as unknown as AgentTurnInput['model'],
    architectureConfig: {},
    requestId: 'r1',
    consoleObserver: null,
    onEvent: () => {},
  };
}

describe('runAgentTurn — headless turn tells the agent how to treat a declined question (2.1.66)', () => {
  it('[ac:ac-odpowiedz-na-pytanie-agenta-w-turze-h] every declined question, from the question tool and from MCP elicitation, reaches an agent told to act on its own recommendation', async () => {
    const { deps, rows, chatService } = makeDeps();
    const result = await runAgentTurn(deps, {
      ...baseInput(),
      // Exactly what `threads.ts` POST /:id/ask passes.
      onUserInput: createHeadlessUserInputHandler({ chat: chatService as never, threadId: 't1', activeAdapters: deps.activeAdapters }),
      headless: true,
      agentPromptNote: HEADLESS_TURN_PROMPT_NOTE,
    });

    expect(result.answer).toBe('Went with M05.');
    // Both sources got `decline`, and the response itself still carries the guidance.
    expect(hoisted.answers).toEqual([
      { action: 'decline', message: HEADLESS_USER_INPUT_GUIDANCE },
      { action: 'decline', message: HEADLESS_USER_INPUT_GUIDANCE },
    ]);
    // What the model is given: the user's message followed by the headless note,
    // which says questions are declined and the agent acts on its own recommendation.
    expect(hoisted.executes).toHaveLength(1);
    const agentPrompt = hoisted.executes[0]!.prompt as string;
    expect(agentPrompt.startsWith(USER_MESSAGE)).toBe(true);
    expect(agentPrompt.endsWith(HEADLESS_TURN_PROMPT_NOTE)).toBe(true);
    expect(HEADLESS_TURN_PROMPT_NOTE).toMatch(/question tool/);
    expect(HEADLESS_TURN_PROMPT_NOTE).toMatch(/MCP elicitation/);
    expect(HEADLESS_TURN_PROMPT_NOTE).toMatch(/declined/);
    expect(HEADLESS_TURN_PROMPT_NOTE).toMatch(/act on your own recommendation/);
    // The thread keeps the user's message as written — the note is not persisted.
    const userRow = rows.find((r) => r.role === 'user')!;
    expect(JSON.parse(userRow.content).text).toBe(USER_MESSAGE);
    expect(rows.some((r) => r.content.includes('<headless_turn>'))).toBe(false);
  });

  it('a chat turn (no prompt note) hands the agent the user message unchanged', async () => {
    const { deps } = makeDeps();
    await runAgentTurn(deps, baseInput());
    expect(hoisted.executes[0]!.prompt).toBe(USER_MESSAGE);
  });
});
