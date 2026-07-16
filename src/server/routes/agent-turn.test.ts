import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';

// 0.1.130: the resolver always folds the C4S artifact dirs (config defaults, resolved vs
// cwd) into the sandbox deny-set, so every turn is scoped even with no user config.
const ARTIFACT_ABS = [
  '.claude4spec/plans',
  '.claude4spec/briefs',
  '.claude4spec/patches',
  '.claude4spec/entities',
  '.claude4spec/releases',
].map((d) => path.resolve(process.cwd(), d));

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
    skillResolver: { resolve: () => [], resolveForContext: () => [] },
    skillRegistry: { has: () => false, resolve: () => { throw new Error('unexpected resolve() call'); } },
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

describe('runAgentTurn — M37 per-context skill injection', () => {
  /** Minimal fake registry backing a fixed set of contextual skills for these tests. */
  function fakeSkillDeps(skills: Record<string, { title: string; description: string; injection: 'forced' | 'available' }>) {
    const skillRegistry = {
      has: (slug: string) => slug in skills,
      resolve: (slug: string) => {
        const s = skills[slug];
        if (!s) throw new Error(`unknown slug "${slug}"`);
        return { metadata: { slug, title: s.title, description: s.description, injection: s.injection, version: 1, language: 'en', scope: 'contextual', source: 'bundled', path: '' }, content: `${slug} body`, files: {} };
      },
    };
    const skillResolver = {
      resolve: () => [],
      resolveForContext: (attach: string[]) =>
        attach.filter((slug) => slug in skills).map((slug) => {
          const r = skillRegistry.resolve(slug);
          return { name: slug, description: r.metadata.description, content: r.content, files: r.files, metadata: { title: r.metadata.title, version: 1, language: 'en', injection: r.metadata.injection } };
        }),
    };
    return { skillRegistry, skillResolver };
  }

  it('patch thread: patch-implementer (forced) is both in inlineSkills and gets a <project_skill> block', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({
      'patch-implementer': { title: 'Patch Implementer', description: 'resolves patches', injection: 'forced' },
    }));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'patch';

    await runAgentTurn(deps, input);

    const skillNames = ((hoisted.lastExecute?.skills ?? []) as Array<{ name: string }>).map((s) => s.name);
    expect(skillNames).toContain('patch-implementer');
    expect(String(hoisted.lastExecute?.systemPrompt)).toContain('<project_skill slug="patch-implementer"');
  });

  it("chat thread: writing-style-author (available) is in inlineSkills but produces NO <project_skill> block", async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({
      'writing-style-author': { title: 'Writing Style Author', description: 'authors styles', injection: 'available' },
    }));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'chat';

    await runAgentTurn(deps, input);

    const skillNames = ((hoisted.lastExecute?.skills ?? []) as Array<{ name: string }>).map((s) => s.name);
    expect(skillNames).toContain('writing-style-author');
    expect(String(hoisted.lastExecute?.systemPrompt)).not.toContain('<project_skill slug="writing-style-author"');
  });
});

describe('runAgentTurn — architectureConfig.claude_sandbox merge (0.1.103 / 0.1.130)', () => {
  it('requests hard enforcement (claude_sandbox) with user scope merged after the artifact deny-set', async () => {
    hoisted.agent = { allowedPaths: ['/allowed/dir'], disallowedPaths: ['/deny/dir'] };
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    const fs = (
      (hoisted.lastExecute?.architectureConfig as Record<string, unknown>).claude_sandbox as {
        enabled: boolean;
        filesystem: { denyRead: string[]; denyWrite: string[]; allowWrite: string[] };
      }
    );
    expect(fs.enabled).toBe(true);
    // 0.1.130: deny lists carry the implicit artifact deny-set + the user's disallowedPaths.
    expect(fs.filesystem.denyRead).toEqual([...ARTIFACT_ABS, '/deny/dir']);
    expect(fs.filesystem.denyWrite).toEqual([...ARTIFACT_ABS, '/deny/dir']);
    expect(fs.filesystem.allowWrite).toEqual(['/allowed/dir']);
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

  it('0.1.130: applies the artifact deny-set even when NO user path scope is configured', async () => {
    hoisted.agent = undefined;
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const input = makeInput();
    input.architectureConfig = { some_existing_flag: 'keep-me' };

    await runAgentTurn(deps, input);

    // The caller's field is preserved, and the sandbox is now ALWAYS built (unconditional
    // hard-lock) — with only the artifact deny-set and no user allow-list.
    const architectureConfig = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(architectureConfig.some_existing_flag).toBe('keep-me');
    const fs = (
      architectureConfig.claude_sandbox as {
        enabled: boolean;
        filesystem: { denyRead: string[]; denyWrite: string[]; allowWrite: string[] };
      }
    );
    expect(fs.enabled).toBe(true);
    expect(fs.filesystem.denyRead).toEqual(ARTIFACT_ABS);
    expect(fs.filesystem.denyWrite).toEqual(ARTIFACT_ABS);
    // Empty allow-list ⇒ cwd stays writable via the library's implicit base.
    expect(fs.filesystem.allowWrite).toEqual([]);
    // The resolved scope is always spread onto execute (library's own gate is non-empty deny).
    expect(hoisted.lastExecute?.allowedPaths).toEqual([]);
    expect(hoisted.lastExecute?.disallowedPaths).toEqual(ARTIFACT_ABS);
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
