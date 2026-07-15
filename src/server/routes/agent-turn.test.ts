import { describe, it, expect, vi, afterEach } from 'vitest';

// 0.1.58: `answer` = the LAST assistant text block of the turn (final summary
// after the terminal `result`), not a concatenation of intermediate texts
// between tool calls. We drive the real runAgentTurn with a scripted event
// stream by mocking the adapter factory; everything else is a thin fake.
const hoisted = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  lastExecute: null as Record<string, unknown> | null,
  // 0.1.103: lets tests control cfg.agent.{allowedPaths,disallowedPaths} without
  // a real config.json on disk — undefined mirrors "nothing configured".
  agent: undefined as { allowedPaths?: string[]; disallowedPaths?: string[] } | undefined,
}));

vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    createAdapter: () => ({
      // eslint-disable-next-line require-yield
      execute: async function* execute(opts: Record<string, unknown>) {
        hoisted.lastExecute = opts;
        for (const e of hoisted.events) yield e;
      },
    }),
  };
});

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    readConfig: (cwd: string) => ({ ...actual.readConfig(cwd), agent: hoisted.agent }),
  };
});

import { runAgentTurn, type AgentTurnDeps, type AgentTurnInput } from './agent-turn.js';

afterEach(() => {
  hoisted.agent = undefined;
});

interface Recorded {
  role: string;
  text: string | null;
  toolName: string | null;
}

function makeDeps() {
  const messages: Recorded[] = [];
  const rows: Array<{
    id: number;
    role: string;
    content: string;
    toolName: string | null;
    subagentTaskId: string | null;
  }> = [];
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
      const id = nextId++;
      rows.push({ id, role, content, toolName: toolName ?? null, subagentTaskId: null });
      return { id };
    },
    // 0.1.79: turn-message slicing for `output: 'full'`.
    latestMessageId: () => rows.at(-1)?.id ?? 0,
    getMessages: () => rows,
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
    // M05 queue: the after-turn merged-dispatch loop drains the queue; an empty
    // queue means no extra turns.
    popAllQueued: () => [],
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
    pagesService: { rootId: 'pages', read: async () => ({ body: '' }), listTree: async () => [] },
    tagsService: { list: () => [] },
    sectionsService: { count: () => 0 },
    planService: {
      // 0.1.127: stale-plan reminder pipeline removed (brief 0-1-126-to-0-1-127) —
      // getByThread is the only method the turn-loop still calls, and it's async now.
      getByThread: async () => null,
    },
    briefService: {},
    patchService: {},
    pageVersions: {},
    skillResolver: { resolve: () => [] },
    skillRegistry: { has: () => false },
    ws: {},
    cwd: process.cwd(),
    roots: [
      {
        id: 'pages',
        name: 'Pages',
        dir: 'pages',
        builtin: true,
        releasable: true,
        sectionIndexed: true,
        referenceValidated: true,
        linkTargets: [],
        sidebar: 'accordion',
        briefTarget: true,
      },
    ],
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

describe('runAgentTurn — ask context posture (0.1.79)', () => {
  it('forces planMode=true even when the thread flag is false, and excludes c4s/transagent tools', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'read-only answer' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as unknown as { contextType: string; planMode: boolean }).contextType = 'ask';
    (input.thread as unknown as { contextType: string; planMode: boolean }).planMode = false;

    const result = await runAgentTurn(deps, input);

    // Builtin posture: read-only regardless of the stored plan_mode flag.
    expect(hoisted.lastExecute?.planMode).toBe(true);
    // Recursion guards: a consulted peer cannot consult/delegate.
    const mcpKeys = Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>);
    expect(mcpKeys).not.toContain('c4s-tools');
    expect(mcpKeys).not.toContain('transagent-tools');
    // plan-tools stay available — a peer can still leave a plan behind.
    expect(mcpKeys).toContain('plan-tools');
    // The turn's messages are returned for output:'full' callers.
    expect(Array.isArray(result.messages)).toBe(true);
  });
});

describe('runAgentTurn — entity-tools mcpServers wiring (M13, 0-1-112-to-0-1-113)', () => {
  it('chat thread: entity-tools (from pluginHost.buildMcpServers) reaches adapter.execute mcpServers', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    (deps.pluginHost as unknown as { buildMcpServers: () => unknown }).buildMcpServers = () => [
      { name: 'entity-tools', server: { config: { type: 'sdk', name: 'entity-tools', instance: {} } } },
      { name: 'endpoint-tools', server: { config: { type: 'sdk', name: 'endpoint-tools', instance: {} } } },
    ];

    await runAgentTurn(deps, makeInput());

    const mcpKeys = Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>);
    expect(mcpKeys).toContain('entity-tools');
    expect(mcpKeys).toContain('endpoint-tools');
  });

  it('brief thread (pluginServers: release-only): entity-tools is excluded, same as every other per-type plugin server', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    (deps.pluginHost as unknown as { buildMcpServers: () => unknown }).buildMcpServers = () => [
      { name: 'entity-tools', server: { config: { type: 'sdk', name: 'entity-tools', instance: {} } } },
      { name: 'release-tools', server: { config: { type: 'sdk', name: 'release-tools', instance: {} } } },
    ];
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'brief';

    await runAgentTurn(deps, input);

    const mcpKeys = Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>);
    expect(mcpKeys).not.toContain('entity-tools');
    expect(mcpKeys).toContain('release-tools');
  });
});

describe('runAgentTurn — architectureConfig.claude_sandbox merge (0.1.103)', () => {
  it('requests hard enforcement (claude_sandbox) when a path scope is configured', async () => {
    hoisted.agent = { allowedPaths: ['/allowed/dir'], disallowedPaths: ['/deny/dir'] };
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(hoisted.lastExecute?.architectureConfig).toMatchObject({
      claude_sandbox: {
        enabled: true,
        filesystem: {
          denyRead: ['/deny/dir'],
          denyWrite: ['/deny/dir'],
          allowWrite: ['/allowed/dir'],
        },
      },
    });
  });

  it('preserves caller-supplied architectureConfig fields alongside claude_sandbox', async () => {
    hoisted.agent = { allowedPaths: ['/allowed/dir'], disallowedPaths: [] };
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const input = makeInput();
    input.architectureConfig = { some_existing_flag: 'keep-me' };

    await runAgentTurn(deps, input);

    const architectureConfig = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(architectureConfig.some_existing_flag).toBe('keep-me');
    expect(architectureConfig.claude_sandbox).toBeDefined();
  });

  it('is an exact no-op when no path scope is configured (ac-puste-allowedpaths-i-disallowedpaths-n)', async () => {
    hoisted.agent = undefined;
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const input = makeInput();
    input.architectureConfig = { some_existing_flag: 'keep-me' };

    await runAgentTurn(deps, input);

    // architectureConfig reaches adapter.execute byte-for-byte unchanged —
    // claude_sandbox must be genuinely ABSENT, not merely undefined.
    const architectureConfig = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(architectureConfig).toEqual({ some_existing_flag: 'keep-me' });
    expect('claude_sandbox' in architectureConfig).toBe(false);
    // The pre-existing conditional-spread behavior for allowedPaths/disallowedPaths
    // (agent-adapters' own soft layer) is untouched by this change.
    expect('allowedPaths' in (hoisted.lastExecute ?? {})).toBe(false);
    expect('disallowedPaths' in (hoisted.lastExecute ?? {})).toBe(false);
  });
});

describe('runAgentTurn — server-side turn timeout (0-1-110-to-next)', () => {
  it('passes caller-supplied timeoutMs into adapter.execute() so AdapterTimeoutError/TIMEOUT is reachable', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const input = makeInput();
    input.timeoutMs = 15 * 60_000;

    await runAgentTurn(deps, input);

    expect(hoisted.lastExecute?.timeoutMs).toBe(15 * 60_000);
  });

  it('leaves timeoutMs unset when the caller omits it (interactive chat must stay unbounded)', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect('timeoutMs' in (hoisted.lastExecute ?? {})).toBe(false);
  });
});
