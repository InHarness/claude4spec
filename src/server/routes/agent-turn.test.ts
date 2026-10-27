import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { TOOL_RESULT_CEILING_TOKENS } from '../discovery/budget.js';
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

/**
 * 0.2.13 item 28: the page roots, denied for WRITE only.
 *
 * The rig's project has the built-in `pages` root and no others. Kept as its own
 * constant rather than appended to `ARTIFACT_ABS`, because the two lists are now
 * governed by different rules and the tests below have to be able to say so: an
 * artifact dir is denied symmetrically, a page root is readable.
 */
const PAGE_ROOTS_ABS = [path.resolve(process.cwd(), 'pages')];

// 0.1.58: `answer` = the LAST assistant text block of the turn (final summary
// after the terminal `result`), not a concatenation of intermediate texts
// between tool calls. We drive the real runAgentTurn with a scripted event
// stream by mocking the adapter factory; everything else is a thin fake.
const hoisted = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  lastExecute: null as Record<string, unknown> | null,
  /**
   * EVERY execute of the turn, in order. `lastExecute` answers "what did the turn
   * end up sending"; this answers "what did each SDK query get" — the distinction
   * the merged-dispatch drain loop made load-bearing (brief `0-2-23-to-next`).
   */
  executes: [] as Array<Record<string, unknown>>,
  // 0.1.103: lets tests control cfg.agent.{allowedPaths,disallowedPaths} without
  // a real config.json on disk — undefined mirrors "nothing configured".
  agent: undefined as
    | { allowedPaths?: string[]; disallowedPaths?: string[]; disableDirectFilesystemAccess?: boolean }
    | undefined,
  /**
   * Stands in for what the SDK does to an sdk-type server: bind it to a
   * transport. Runs inside `execute`, before any event is yielded, so a test can
   * decide which servers came up and which stayed dark — the difference the
   * mount guard reports on.
   */
  onExecute: null as ((opts: Record<string, unknown>) => void) | null,
  /**
   * Runs before each event is yielded — lets a test change the world mid-stream.
   * Awaited, so a test can also make a real request inside a window of the turn
   * (the hold between a `result` and its continuation).
   */
  beforeEvent: null as
    | ((event: Record<string, unknown>, opts: Record<string, unknown>) => unknown)
    | null,
}));

vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    createAdapter: () => ({
      // eslint-disable-next-line require-yield
      execute: async function* execute(opts: Record<string, unknown>) {
        hoisted.lastExecute = opts;
        hoisted.executes.push(opts);
        hoisted.onExecute?.(opts);
        for (const e of hoisted.events) {
          await hoisted.beforeEvent?.(e, opts);
          yield e;
        }
      },
    }),
  };
});

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    /**
     * 0.2.53: MERGE the override into the normalized branch instead of replacing
     * it. `readConfig` guarantees every field of `agent` (that is what
     * `NormalizedAgentConfig` is for), and consumers read them without `??`; a
     * mock that swapped the whole branch for a two-field literal was handing the
     * turn a shape the real reader can never produce.
     */
    readConfig: (cwd: string) => {
      const cfg = actual.readConfig(cwd);
      return { ...cfg, agent: { ...cfg.agent, ...hoisted.agent } };
    },
  };
});

import {
  AdapterAbortError,
  AdapterBackgroundHoldExpiredError,
  AdapterIdleTimeoutError,
  AdapterInitError,
  AdapterTimeoutError,
  AdapterToolPolicyError,
} from '@inharness-ai/agent-adapters';
import { abortChildTurns, runAgentTurn, type ActiveAdapter, type AgentTurnDeps, type AgentTurnInput } from './agent-turn.js';
import { SpecSkillTools } from '../mcp/spec-skill-tools.js';
import { buildC4sToolsServer } from '../mcp/c4s-tools.js';
import { createMcpServer, mcpTool } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { CONTEXT_TYPE_REGISTRY } from '../services/chat-context.js';
import { ChatService } from '../services/chat.js';
import { runMigrations } from '../db/migrate.js';
import {
  BACKGROUND_WAKEUP_GRACE_MS,
  CLAUDE_CODE_SUPPRESSED_HARNESS_TOOLS,
  CLAUDE_CODE_TASK_TRACKING_TOOLS,
} from '@inharness-ai/agent-adapters/claude-code';
import {
  AgentTurnError,
  assertTurnClockInvariants,
  BACKGROUND_HOLD_CAP_MS,
  IDLE_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
} from '../../shared/agent-turn.js';

/** The options `ProjectPluginHost.buildMcpServers` takes — fakes honour `include` like the real host. */
type HostBuildOpts = { strict?: boolean; include?: (name: string) => boolean };

afterEach(() => {
  hoisted.agent = undefined;
  hoisted.executes = [];
  hoisted.onExecute = null;
  hoisted.beforeEvent = null;
});

interface Recorded {
  role: string;
  text: string | null;
  toolName: string | null;
}

function makeDeps() {
  const messages: Recorded[] = [];
  // 0.2.8 (C15): the turn-1 resume snapshot, captured instead of persisted.
  const snapshots: Array<Record<string, unknown>> = [];
  const storedSnapshot: { json?: string } = {};
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
    setInitialArchitectureConfig: (_id: string, snapshot: Record<string, unknown>) => {
      snapshots.push(snapshot);
    },
    // 0.2.113: a resumed turn reads its session's snapshot back. `storedSnapshot`
    // seeds the one "already in the database"; none means a thread without one.
    getInitialArchitectureConfig: () => (storedSnapshot.json ?? null),
    setLastUsage: () => {},
    setLastSessionId: (_id: string, _sessionId: string) => {},
    recordSession(id: string, sessionId: string, snapshot: Record<string, unknown>) {
      this.setLastSessionId(id, sessionId);
      this.setInitialArchitectureConfig(id, snapshot);
    },
    attachTurnUsage: () => {},
    setLastContextSize: () => {},
    attachTurnContextSize: () => {},
    markToolUseComplete: () => {},
    startSubagentTask: () => {},
    updateSubagentTaskProgress: () => {},
    completeSubagentTask: () => {},
    // M17 background tasks (sibling to the subagent stubs above).
    startBackgroundTask: () => {},
    updateBackgroundTaskProgress: () => {},
    completeBackgroundTask: () => {},
    finalizeRunningBackgroundTasks: () => {},
    finalizeRunningSubagentTasks: () => {},
    updateCurrentTodoItems: () => {},
    finalizeStreamingRows: () => {},
    // M05 queue: the after-turn merged-dispatch loop drains the queue; an empty
    // queue means no extra turns.
    popAllQueued: () => [],
  };

  const deps = {
    pluginHost: {
      listEntities: () => [],
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
      },
    ],
    mode: 'dev',
    db: { handle: {} },
  } as unknown as AgentTurnDeps;

  return { deps, messages, snapshots, storedSnapshot };
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
    model: 'claude-opus-5' as unknown as AgentTurnInput['model'],
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

describe('runAgentTurn — patch thread posture (0.2.30)', () => {
  it('leaves a patch thread with plan_mode=false unrestricted, so a banka spawned from a plan-mode parent keeps Write/Edit/Bash', async () => {
    // The other half of the no-inheritance rule (dispatcher side:
    // transagent-dispatcher.test.ts). `patch` declares no `force-plan` posture,
    // so the turn follows the thread flag — and a child created without
    // `planMode` carries false, whatever the parent had.
    hoisted.events = [
      { type: 'text_delta', text: 'patched' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as unknown as { contextType: string; patchPath: string | null }).contextType =
      'patch';
    (input.thread as unknown as { contextType: string; patchPath: string | null }).patchPath =
      'patches/p.md';

    await runAgentTurn(deps, input);

    // planMode=false ⇒ the preset contributes no deny-groups. Since 0.2.53 the
    // PROJECT CONSTANT still does, so the turn is not unrestricted — see the
    // posture suite below for what it carries.
    expect(hoisted.lastExecute?.planMode).toBe(false);
  });
});

/**
 * 0.2.65 — the task family is opted into EXPLICITLY, and the test that matters
 * is the second one: the posture where the opt-in used to vanish.
 *
 * The library sets `options.tools` only when at least one group is denied, so a
 * project with direct FS access allowed denies nothing and — past SDK 0.3.233,
 * where these tools are off by default — would silently lose them. Asserting the
 * field only under the default posture would have passed against that bug.
 */
describe('runAgentTurn — task-tool opt-in (0.2.65)', () => {
  const settle = () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
  };
  const TASK_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList'];

  for (const disableDirectFilesystemAccess of [true, false]) {
    it(`names the whole task family with disableDirectFilesystemAccess=${disableDirectFilesystemAccess}`, async () => {
      settle();
      hoisted.agent = { disableDirectFilesystemAccess };
      const { deps } = makeDeps();

      await runAgentTurn(deps, makeInput());

      expect(hoisted.lastExecute?.autoApproveTools).toEqual(TASK_TOOLS);
    });
  }

  /**
   * Pinned to the LIBRARY's constant, not to the five literals above. Spelling
   * them out here and in the source would let an upstream rename pass both — the
   * test would keep asserting the old names against a field the adapter no longer
   * recognizes, which is the exact failure mode this opt-in exists to prevent.
   */
  it('takes the family from the library rather than a local literal', async () => {
    settle();
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(hoisted.lastExecute?.autoApproveTools).toBe(CLAUDE_CODE_TASK_TRACKING_TOOLS);
    // And the constant is what we think it is — a rename upstream fails HERE,
    // with a message naming the tools, rather than silently at runtime.
    expect(CLAUDE_CODE_TASK_TRACKING_TOOLS).toEqual(TASK_TOOLS);
  });
});

/**
 * 0.2.53 (M18 II) — the built-in tool posture handed to `adapter.execute`.
 *
 * Two axes with different lifetimes composed into ONE union, and the property
 * that matters is that composition is a SUM: whichever axis is active, nothing
 * the other one denied comes back.
 */
describe('runAgentTurn — disallowedToolGroups posture', () => {
  const settle = () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
  };

  it('[ac:ac-przy-agent-disabledirectfilesystemacc] denies file-read, file-write and shell by default', async () => {
    settle();
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect([...(hoisted.lastExecute?.disallowedToolGroups as string[])].sort()).toEqual([
      'file-read',
      'file-write',
      'shell',
    ]);
  });

  it('declares no groups of its own when the project allows direct FS access', async () => {
    settle();
    hoisted.agent = { disableDirectFilesystemAccess: false };
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(hoisted.lastExecute?.disallowedToolGroups).toEqual([]);
  });

  /**
   * The union, from the side that could actually go wrong: with the flag OFF,
   * plan mode must still contribute its own groups. A builder that returned the
   * project constant and stopped would silently un-gate plan mode.
   */
  it('[ac:ac-efektywne-disallowedtoolgroups-tury-t] unions the plan-mode preset in when the flag is off', async () => {
    settle();
    hoisted.agent = { disableDirectFilesystemAccess: false };
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as { planMode: boolean }).planMode = true;

    await runAgentTurn(deps, input);

    expect([...(hoisted.lastExecute?.disallowedToolGroups as string[])].sort()).toEqual([
      'file-write',
      'shell',
    ]);
  });

  /** Overlapping groups collapse — the union is a set, not a concatenation. */
  it('does not duplicate a group both axes deny', async () => {
    settle();
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as { planMode: boolean }).planMode = true;

    await runAgentTurn(deps, input);

    const groups = hoisted.lastExecute?.disallowedToolGroups as string[];
    expect([...groups].sort()).toEqual(['file-read', 'file-write', 'shell']);
    expect(new Set(groups).size).toBe(groups.length);
  });

  /**
   * 0.2.87 (M44): a brief thread holds no built-ins whatever the project flag says —
   * its content arrives through `get_brief`, so there is no path-traversal surface.
   */
  it('brief thread denies file-read, file-write and shell even with direct FS access allowed', async () => {
    settle();
    hoisted.agent = { disableDirectFilesystemAccess: false };
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as unknown as { contextType: string; briefPath: string }).contextType = 'brief';
    (input.thread as unknown as { contextType: string; briefPath: string }).briefPath = 'b.md';

    await runAgentTurn(deps, input);

    expect([...(hoisted.lastExecute?.disallowedToolGroups as string[])].sort()).toEqual([
      'file-read',
      'file-write',
      'shell',
    ]);
    // Plan mode still follows the thread flag — the built-in axis is separate.
    expect(hoisted.lastExecute?.planMode).toBe(false);
  });

  /**
   * 0.2.87 (M44): background-task policy comes from the registry row, not an
   * inline `contextType === 'ask'`. With FS access allowed the shell is not denied,
   * so only the declared policy decides.
   */
  for (const [contextType, disallowed] of [
    ['chat', false],
    ['patch', false],
    ['ask', true],
  ] as const) {
    it(`background tasks for ${contextType}: ${disallowed ? 'disabled' : 'allowed'} by the registry row`, async () => {
      settle();
      hoisted.agent = { disableDirectFilesystemAccess: false };
      const { deps } = makeDeps();
      const input = makeInput();
      (input.thread as unknown as { contextType: string; patchPath: string }).contextType = contextType;
      (input.thread as unknown as { contextType: string; patchPath: string }).patchPath = 'p.md';

      await runAgentTurn(deps, input);

      const arch = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
      expect(arch.claude_disallowBackgroundBash === true).toBe(disallowed);
    });
  }

  /**
   * The snapshot records the FIELD, never the computed union — the resume guard
   * depends on being able to tell the two axes apart.
   */
  it('snapshots the config field rather than the resolved groups', async () => {
    settle();
    const { deps, snapshots } = makeDeps();

    await runAgentTurn(deps, makeInput());

    const snapshot = snapshots.at(-1) as Record<string, unknown>;
    expect(snapshot.disableDirectFilesystemAccess).toBe(true);
    expect(snapshot).not.toHaveProperty('disallowedToolGroups');
    expect(snapshot).not.toHaveProperty('planMode');
  });
});

/**
 * 0.2.54 — `subagentsFor`'s fourth argument. `hasSkillSlug` is INJECTED here rather than
 * imported by the resolver, because `skill-registry.ts` imports `CONTEXT_TYPE_REGISTRY`
 * from `chat-context.ts` and the reverse import would close a cycle. If this wiring is
 * dropped the resolver silently falls back to accept-all and unknown slugs reach the SDK.
 */
describe('runAgentTurn — plugin subagent contributions reach adapter.execute (0.2.54)', () => {
  const settle = () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
  };

  const contribution = {
    name: 'domain-explore',
    description: 'Explores the domain.',
    promptBody: 'Body.',
    tools: ['mcp__reference-tools__get_page'],
    attachInternalSkills: ['real', 'ghost'],
  };

  it('passes the contribution through, and the skill registry decides which slugs survive', async () => {
    settle();
    hoisted.agent = { disableDirectFilesystemAccess: false };
    const { deps } = makeDeps();
    (deps.pluginHost as unknown as { listSubagents: () => unknown[] }).listSubagents = () => [
      contribution,
    ];
    (deps.skillRegistry as unknown as { has: (s: string) => boolean }).has = (slug) =>
      slug === 'real';

    await runAgentTurn(deps, makeInput());

    const subs = hoisted.lastExecute?.subagents as { name: string; skills?: string[] }[];
    expect(subs.map((s) => s.name)).toEqual(['spec-explore', 'domain-explore']);
    // The unknown slug is dropped; the entry itself survives.
    expect(subs[1]!.skills).toEqual(['real']);
  });

  it('mounts only the built-in when the pool contributes nothing', async () => {
    settle();
    const { deps } = makeDeps();
    await runAgentTurn(deps, makeInput());
    expect((hoisted.lastExecute?.subagents as { name: string }[]).map((s) => s.name)).toEqual([
      'spec-explore',
    ]);
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
    // Honours `include` like the real host: the name predicate runs before a factory.
    (deps.pluginHost as unknown as { buildMcpServers: (o?: HostBuildOpts) => unknown }).buildMcpServers = (o) =>
      [
        { name: 'entity-tools', server: { config: { type: 'sdk', name: 'entity-tools', instance: {} } } },
        { name: 'release-tools', server: { config: { type: 'sdk', name: 'release-tools', instance: {} } } },
      ].filter(({ name }) => !o?.include || o.include(name));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'brief';

    await runAgentTurn(deps, input);

    const mcpKeys = Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>);
    expect(mcpKeys).not.toContain('entity-tools');
    expect(mcpKeys).toContain('release-tools');
  });
});

/**
 * Brief `0-2-23-to-next` — MCP servers went silent partway through a turn.
 *
 * An `McpServer` binds to exactly ONE transport: `Protocol.connect` throws once
 * an instance holds one, and `_onclose` nulls the binding plus aborts in-flight
 * request handlers. The Claude Agent SDK swallows that connect rejection into a
 * debug log and advertises the server anyway, so a shared instance does not fail
 * loudly — the tool calls of the second query simply never produce a
 * `tool_result`, for every whitelisted server at once.
 *
 * `mcpServers` was built once per TURN, but `adapter.execute` runs once per
 * QUERY, and the merged-dispatch drain loop issues one query per queued batch.
 * These tests pin the unit: instance identity must differ between the executes
 * of a single turn.
 */
describe('runAgentTurn — one MCP server set per adapter.execute (0-2-23-to-next)', () => {
  /** Drains exactly one queued batch, so the turn runs two executes. */
  function queueOneFollowUp(deps: AgentTurnDeps): void {
    let drained = false;
    (deps.chatService as unknown as { popAllQueued: () => Array<{ prompt: string }> }).popAllQueued = () => {
      if (drained) return [];
      drained = true;
      return [{ prompt: 'queued follow-up' }];
    };
  }

  function instanceOf(execute: Record<string, unknown> | undefined, server: string): unknown {
    const servers = (execute?.mcpServers ?? {}) as Record<string, { instance?: unknown }>;
    return servers[server]?.instance;
  }

  it('host-owned servers (plan-tools) get a fresh instance for the drain-loop execute', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    queueOneFollowUp(deps);

    await runAgentTurn(deps, makeInput());

    expect(hoisted.executes).toHaveLength(2);
    const first = instanceOf(hoisted.executes[0], 'plan-tools');
    const second = instanceOf(hoisted.executes[1], 'plan-tools');
    // Present in both — the server is still mounted for the merged turn…
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // …but never the SAME object. This is the assertion that failed before the fix.
    expect(second).not.toBe(first);
  });

  it('plugin-contributed servers are re-built from their factory per execute', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    // Mirrors the real host: every `buildMcpServers()` call invokes the registered
    // factories, so each call yields brand-new instances.
    let built = 0;
    (deps.pluginHost as unknown as { buildMcpServers: () => unknown }).buildMcpServers = () => {
      built += 1;
      return [
        { name: 'entity-tools', server: { config: { type: 'sdk', name: 'entity-tools', instance: { build: built } } } },
      ];
    };
    queueOneFollowUp(deps);

    await runAgentTurn(deps, makeInput());

    expect(hoisted.executes).toHaveLength(2);
    /**
     * Two executes plus ONE more: 0.2.50 calls `buildMcpEntries()` a third time,
     * up where the system prompt is assembled, to derive `<tooling>` from the
     * set the turn will actually mount rather than from a hand-written list
     * beside it. That call's handles are read for their declared tool names and
     * dropped — they are never mounted, so they never reach `assertFreshMount`,
     * and building them is safe precisely because of what this test asserts:
     * every call to the host yields brand-new instances.
     */
    expect(built).toBe(3);
    // The invariant itself, unchanged: no instance is shared between executes.
    expect(instanceOf(hoisted.executes[1], 'entity-tools')).not.toBe(
      instanceOf(hoisted.executes[0], 'entity-tools'),
    );
  });

  it('the mounted server SET is unchanged across executes — only the instances differ', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    queueOneFollowUp(deps);

    await runAgentTurn(deps, makeInput());

    const keys = hoisted.executes.map((e) =>
      Object.keys((e.mcpServers ?? {}) as Record<string, unknown>).sort(),
    );
    expect(keys[1]).toEqual(keys[0]);
    expect(keys[0].length).toBeGreaterThan(0);
  });
});

describe('runAgentTurn — M37 per-context skill injection', () => {
  /** Minimal fake registry backing a fixed set of skills for these tests. */
  function fakeSkillDeps(skills: Record<string, { title: string; description: string; scope?: 'contextual' | 'writing-style' }>) {
    const skillRegistry = {
      has: (slug: string) => slug in skills,
      resolve: (slug: string) => {
        const s = skills[slug];
        if (!s) throw new Error(`unknown slug "${slug}"`);
        return { metadata: { slug, title: s.title, description: s.description, version: 1, language: 'en', scope: s.scope ?? 'contextual', source: 'plugin', path: '' }, content: `${slug} body`, files: {} };
      },
    };
    const skillResolver = {
      resolveWritingStyle: () => null,
      // Mirrors the real resolveForContext. 0.2.66: there is no attach list to read
      // any more — the listing is the plugin fan-out filtered by each contribution's
      // own `contextTypes`, and this fake stands in for the one envelope that
      // narrows itself (`writing-style-author`, chat only).
      //
      // 0.2.36: it answers METADATA — a `listing` for `<available_skills>` and the
      // writing style as its OWN field, never as a listing row.
      resolveForContext: (contextType: string) => {
        const contextual = Object.entries(skills)
          .filter(([, s]) => (s.scope ?? 'contextual') === 'contextual')
          .map(([slug]) => slug)
          .filter((slug) => slug !== 'writing-style-author' || contextType === 'chat');
        const styleSlug = Object.entries(skills).find(([, s]) => s.scope === 'writing-style')?.[0];
        const listing = contextual
          .filter((slug) => slug !== styleSlug)
          .map((slug) => ({ slug, description: skills[slug]!.description, origin: 'plugin' as const }));
        return {
          listing,
          writingStyle: styleSlug ? { slug: styleSlug, title: skills[styleSlug]!.title } : null,
        };
      },
    };
    return { skillRegistry, skillResolver };
  }

  it('patch thread: attaches no mode skill at all — `patch-implementer` no longer exists', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({}));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'patch';

    await runAgentTurn(deps, input);

    // 0.2.36: nothing is materialized — `skills` is not passed to execute at all.
    expect(hoisted.lastExecute).not.toHaveProperty('skills');
    const prompt = String(hoisted.lastExecute?.systemPrompt);
    expect(prompt).not.toContain('<project_skill');
    // The block is still emitted, empty: an absent one would be indistinguishable
    // from a host with no concept of skills.
    expect(prompt).toContain('<available_skills>');
  });

  it('patch thread: gets its identity from <interaction_context>, not from a skill', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({}));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'patch';

    await runAgentTurn(deps, input);

    expect(String(hoisted.lastExecute?.systemPrompt)).toContain('<interaction_context type="patch">');
  });

  it('chat thread: writing-style-author is a listing row, NOT a <project_skill> block', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({
      'writing-style-author': { title: 'Writing Style Author', description: 'authors styles' },
    }));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'chat';

    await runAgentTurn(deps, input);

    const prompt = String(hoisted.lastExecute?.systemPrompt);
    expect(prompt).toContain('<skill slug="writing-style-author" description="authors styles" origin="plugin"/>');
    expect(prompt).not.toContain('<project_writing_skill slug="writing-style-author"');
    // The listing carries the description and NOTHING of the body: that is the
    // release's budget claim, and the only assertion that can falsify it.
    expect(prompt).not.toContain('writing-style-author body');
  });

  it('the active writing style is the one skill that gets the <project_writing_skill> block', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({
      'writing-style-author': { title: 'Writing Style Author', description: 'authors styles' },
      'house-style': { title: 'House Style', description: 'the active style', scope: 'writing-style' },
    }));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'chat';

    await runAgentTurn(deps, input);

    const prompt = String(hoisted.lastExecute?.systemPrompt);
    expect(prompt).toContain('<project_writing_skill slug="house-style"');
    expect(prompt.match(/<project_writing_skill /g)?.length).toBe(1);
  });

  /**
   * 0.2.66 — this used to guard a stale process whose in-package root had not been
   * re-scanned. That root is gone, and so is the window; what the empty registry now
   * stands for is the ORDINARY case of a project with no plugins loaded, which is
   * exactly where `<available_skills>` is emitted with nothing in it.
   */
  it('emits an empty listing and no <project_skill> block when the registry is empty', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({})); // a project with no plugins loaded.
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'chat';

    const result = await runAgentTurn(deps, input);

    expect(result.answer).toBe('ok');
    const prompt = String(hoisted.lastExecute?.systemPrompt);
    expect(prompt).not.toContain('<skill slug="writing-style-author"');
    expect(prompt).not.toContain('<project_skill');
    // The block itself is still emitted — an absent block would be indistinguishable
    // from "this host has no notion of skills".
    expect(prompt).toContain('<available_skills>');
  });
});

describe('runAgentTurn — the MCP tool-result ceiling (2.1.5)', () => {
  const env = () =>
    (hoisted.lastExecute?.architectureConfig as Record<string, unknown>).custom_env as Record<string, unknown>;

  it('[ac:ac-kazda-tura-agenta-przekazuje-adaptero] pins MAX_MCP_OUTPUT_TOKENS on every turn, with no API key set', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    await runAgentTurn(deps, makeInput());
    expect(env().MAX_MCP_OUTPUT_TOKENS).toBe(String(TOOL_RESULT_CEILING_TOKENS));
    expect(env().MAX_MCP_OUTPUT_TOKENS).toBe('25000');
    expect(env()).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('[ac:ac-max-mcp-output-tokens-przyslane-przez] the server value replaces a client-sent one; other client keys survive', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const input = makeInput();
    input.architectureConfig = { custom_env: { MAX_MCP_OUTPUT_TOKENS: '999999', ANTHROPIC_API_KEY: 'sk-x', OTHER: '1' } };
    await runAgentTurn(deps, input);
    expect(env()).toEqual({ MAX_MCP_OUTPUT_TOKENS: '25000', ANTHROPIC_API_KEY: 'sk-x', OTHER: '1' });
  });

  it('keeps the ceiling out of the turn-1 snapshot', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps, snapshots } = makeDeps();
    await runAgentTurn(deps, makeInput());
    for (const snap of snapshots) expect(JSON.stringify(snap)).not.toContain('MAX_MCP_OUTPUT_TOKENS');
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
    // 0.2.13 item 28: and denyWrite carries the page roots ON TOP of that — the
    // asymmetry is the point. A page must stay greppable (`denyRead` above is
    // unchanged) while `create_page` / `update_page` / `delete_page` /
    // `update_sections` become the only way to write one.
    expect(fs.filesystem.denyWrite).toEqual([...ARTIFACT_ABS, '/deny/dir', ...PAGE_ROOTS_ABS]);
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
    expect(fs.filesystem.denyWrite).toEqual([...ARTIFACT_ABS, ...PAGE_ROOTS_ABS]);
    // Empty allow-list ⇒ cwd stays writable via the library's implicit base.
    expect(fs.filesystem.allowWrite).toEqual([]);
    // The resolved scope is always spread onto execute (library's own gate is non-empty deny).
    expect(hoisted.lastExecute?.allowedPaths).toEqual([]);
    /**
     * `disallowedPaths` deliberately does NOT gain the page roots.
     *
     * The vendor turns this list into symmetric Read+Edit+Write permission
     * rules, and the resume lock compares it turn over turn. A page root here
     * would have cost the agent every `Grep` over the specification AND relocked
     * every thread opened before this release.
     */
    expect(hoisted.lastExecute?.disallowedPaths).toEqual(ARTIFACT_ABS);
  });
});

// 0.2.8 (C15): the FS path scope is resume-immutable per the library contract, but it was
// missing from the turn-1 snapshot — and `findResumeViolations` treats a field absent on
// either side as "not changed", so the guard could never fire on a scope change.
describe('runAgentTurn — resume snapshot carries the FS path scope (0.2.8 / C15)', () => {
  it('snapshots allowedPaths/disallowedPaths alongside model + architectureConfig', async () => {
    hoisted.agent = { allowedPaths: ['/allowed/dir'], disallowedPaths: ['/deny/dir'] };
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps, snapshots } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0] as {
      model: string;
      allowedPaths: string[];
      disallowedPaths: string[];
    };
    expect(snapshot.model).toBeDefined();
    expect(snapshot.allowedPaths).toEqual(['/allowed/dir']);
    // Normalized: deduped and SORTED, because the library compares snapshots by
    // JSON.stringify — a reordered but identical list must not read as a change.
    expect(snapshot.disallowedPaths).toEqual([...ARTIFACT_ABS, '/deny/dir'].sort());
  });

  it('does NOT snapshot a turn that never produced a session', async () => {
    // The guard only engages once `lastSessionId` is set. A snapshot left behind by a turn
    // that died before its `result` would become the reference point for a session it never
    // created — the next turn (still session-less) is waved through and opens the session
    // under the CURRENT config, and every turn after that compares against the stale
    // snapshot: a thread that can never be resumed again.
    hoisted.agent = { allowedPaths: ['/allowed/dir'], disallowedPaths: [] };
    hoisted.events = []; // stream ends with no `result`, so no sessionId
    const { deps, snapshots } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(snapshots).toEqual([]);
  });

  it('snapshots the artifact deny-set even with no user path scope configured', async () => {
    hoisted.agent = undefined;
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps, snapshots } = makeDeps();

    await runAgentTurn(deps, makeInput());

    const snapshot = snapshots[0] as { allowedPaths: string[]; disallowedPaths: string[] };
    expect(snapshot.allowedPaths).toEqual([]);
    expect(snapshot.disallowedPaths).toEqual([...ARTIFACT_ABS].sort());
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

  /**
   * 0.2.50 REVERSES the previous assertion here.
   *
   * Interactive chat used to pass no timeout at all, on purpose. The background
   * hold cap makes that untenable: with no turn timeout above it, a hold that
   * outlives its cap and a turn that simply hung are indistinguishable. The
   * turn is now always bounded, just very loosely.
   */
  it('falls back to TURN_TIMEOUT_MS when the caller omits it (interactive chat)', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(hoisted.lastExecute?.timeoutMs).toBe(TURN_TIMEOUT_MS);
  });

  /**
   * The invariant that gives `AdapterBackgroundHoldExpiredError` its meaning.
   * If the cap ever reached or passed the turn timeout, a hold expiry would
   * surface as a bare `AdapterTimeoutError` and we would lose the distinction
   * between "the hold expired" and "the turn hung" — different bugs, different
   * fixes.
   */
  it('[ac:ac-wartosc-timeoutms-przekazywana-do-ada] keeps the idle clock strictly above hold cap + grace', () => {
    // 0.2.107: otherwise idle expiry could pre-empt the typed hold-expired error.
    expect(IDLE_TIMEOUT_MS).toBeGreaterThan(BACKGROUND_HOLD_CAP_MS + BACKGROUND_WAKEUP_GRACE_MS);
    expect(TURN_TIMEOUT_MS).toBeGreaterThan(BACKGROUND_HOLD_CAP_MS);
  });

  it('[ac:ac-backstop-timeoutms-przekazywany-do-ad] keeps the timeoutMs backstop at least an order of magnitude above the idle clock', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(hoisted.lastExecute?.timeoutMs).toBe(86_400_000);
    expect(hoisted.lastExecute?.timeoutMs as number).toBeGreaterThanOrEqual(10 * IDLE_TIMEOUT_MS);
  });

  /**
   * `Infinity` does not disarm the library's idle clock — `setTimeout` clamps it
   * and the turn would die at once. Omitting the field is the only "off".
   */
  it('refuses a non-finite idle budget at module load', () => {
    const clocks = {
      turnTimeoutMs: TURN_TIMEOUT_MS,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      holdCapMs: BACKGROUND_HOLD_CAP_MS,
      graceMs: BACKGROUND_WAKEUP_GRACE_MS,
    };
    expect(() => assertTurnClockInvariants(clocks)).not.toThrow();
    expect(() => assertTurnClockInvariants({ ...clocks, idleTimeoutMs: Infinity })).toThrow(/idleTimeoutMs must be finite/);
    expect(() => assertTurnClockInvariants({ ...clocks, turnTimeoutMs: 9 * IDLE_TIMEOUT_MS })).toThrow(/10x/);
  });

  /**
   * The library treats `null`/`Infinity` as a sentinel meaning "disarm the
   * cap", which would let a wedged background task hold a session open with no
   * bound at all.
   */
  it('[ac:ac-cap-oczekiwania-na-zadania-w-tle-nigd] arms the hold cap with a finite positive number, never a disarm sentinel', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    const cap = (hoisted.lastExecute?.architectureConfig as Record<string, unknown>)
      ?.claude_backgroundHoldCapMs;
    expect(typeof cap).toBe('number');
    expect(Number.isFinite(cap as number)).toBe(true);
    expect(cap).toBe(BACKGROUND_HOLD_CAP_MS);
  });
});

describe('runAgentTurn — M17 background tasks (0-1-141-to-next-2)', () => {
  it('persists background_task_* events and forwards the non-terminal result without ending the turn', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'Backgrounding a sleep. ' },
      { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'sleep 5' },
      // HELD result — engine still running the sleep, NOT end-of-run.
      {
        type: 'result',
        sessionId: 's-held',
        usage: { inputTokens: 10, outputTokens: 5 },
        contextSize: 15,
        backgroundTasks: [{ taskId: 'bg1', taskType: 'shell' }],
      },
      { type: 'background_task_completed', taskId: 'bg1', taskType: 'shell', status: 'success', summary: 'slept' },
      { type: 'text_delta', text: 'The sleep finished.' },
      // FINAL result — nothing in flight, genuine end-of-run.
      {
        type: 'result',
        sessionId: 's-final',
        usage: { inputTokens: 20, outputTokens: 8 },
        contextSize: 28,
      },
    ];

    const { deps } = makeDeps();
    const cs = deps.chatService as unknown as {
      startBackgroundTask: (...a: unknown[]) => void;
      completeBackgroundTask: (...a: unknown[]) => void;
      setLastSessionId: (...a: unknown[]) => void;
    };
    const started = vi.spyOn(cs, 'startBackgroundTask');
    const completed = vi.spyOn(cs, 'completeBackgroundTask');
    const setSession = vi.spyOn(cs, 'setLastSessionId');

    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    const result = await runAgentTurn(deps, input);

    // The continuation turn's text is the answer — the held result did not end it early.
    expect(result.answer).toBe('The sleep finished.');

    // Background task persisted via the dedicated (non-subagent) methods, taskType by name.
    expect(started).toHaveBeenCalledWith('t1', 'bg1', 'shell', 'sleep 5');
    expect(completed).toHaveBeenCalledWith('t1', 'bg1', 'shell', 'success', null, 'slept');

    // 0.2.109: BOTH results reach the client — terminality is not read from the
    // payload, and since agent-chat 0.4.0 a `result` closes a block, not the turn.
    // The continuation opens with a `turn_start`, and the stream ends once, on
    // generator exhaustion.
    const types = emitted.map((e) => e.type);
    expect(emitted.filter((e) => e.type === 'result').map((e) => e.sessionId)).toEqual([
      's-held',
      's-final',
    ]);
    const heldIdx = types.indexOf('result');
    const contIdx = types.indexOf('turn_start');
    expect(contIdx).toBeGreaterThan(types.indexOf('background_task_completed'));
    expect(contIdx).toBeGreaterThan(heldIdx);
    expect(types.filter((t) => t === 'done')).toEqual(['done']);
    expect(types[types.length - 1]).toBe('done');

    // The background_task_* events themselves DO reach the client (rendered as a panel).
    expect(emitted.filter((e) => e.type === 'background_task_started')).toHaveLength(1);
    expect(emitted.filter((e) => e.type === 'background_task_completed')).toHaveLength(1);

    // Held result still advances the session anchor; final result advances it again.
    expect(setSession).toHaveBeenCalledWith('t1', 's-held');
    expect(setSession).toHaveBeenCalledWith('t1', 's-final');
  });

  /**
   * 0.2.109 — every `result` stamps usage onto its OWN segment's anchor row.
   *
   * Whether a `result` is terminal is unknowable at the time it arrives, so no
   * `result` can be treated as "the closing one". Each segment (before the
   * park, the continuation) stamps the row it produced, so neither overwrites
   * the other — which is what agent-chat 0.4.0 shows live: a message's usage
   * is the sum over every `result` it received.
   */
  it('stamps each segment\'s usage onto its own anchor row', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'working ' },
      // Usage reaches the turn through `assistant_message`, which is what
      // `attachTurnUsage` ultimately stamps.
      { type: 'assistant_message', message: { usage: { inputTokens: 10, outputTokens: 5 } } },
      { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'build' },
      {
        type: 'result',
        sessionId: 's-held',
        usage: { inputTokens: 10, outputTokens: 5 },
        contextSize: 15,
        backgroundTasks: [{ taskId: 'bg1', taskType: 'shell' }],
      },
      { type: 'background_task_completed', taskId: 'bg1', taskType: 'shell', status: 'exited 0' },
      { type: 'text_delta', text: 'done' },
      { type: 'assistant_message', message: { usage: { inputTokens: 20, outputTokens: 8 } } },
      {
        type: 'result',
        sessionId: 's-final',
        usage: { inputTokens: 20, outputTokens: 8 },
        contextSize: 28,
      },
    ];
    const { deps } = makeDeps();
    const cs = deps.chatService as unknown as {
      attachTurnUsage: (...a: unknown[]) => void;
    };
    const attach = vi.spyOn(cs, 'attachTurnUsage');

    await runAgentTurn(deps, makeInput());

    expect(attach).toHaveBeenCalledTimes(2);
    const calls = attach.mock.calls as Array<[string, number, { outputTokens: number }]>;
    expect(calls.map(([, , u]) => u.outputTokens)).toEqual([5, 8]);
    // Two different anchors — the continuation did not overwrite the first segment.
    expect(calls[0][1]).not.toBe(calls[1][1]);
  });

  /**
   * 2.1.51: the anchors belong to the turn. A merged turn that produces no main
   * assistant row (and no tool_result) has nothing to stamp — it must not land
   * its usage on the previous turn's row.
   */
  it('does not stamp a merged turn\'s usage onto the previous turn\'s row', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'first turn' },
      { type: 'assistant_message', message: { usage: { inputTokens: 10, outputTokens: 5 } } },
      { type: 'result', sessionId: 's1', usage: { inputTokens: 10, outputTokens: 5 }, contextSize: 15 },
    ];
    const { deps } = makeDeps();
    let drained = false;
    (deps.chatService as unknown as { popAllQueued: () => Array<{ prompt: string }> }).popAllQueued = () => {
      if (drained) return [];
      drained = true;
      // The merged turn yields a bare `result` — no text, no tool output.
      hoisted.events = [
        { type: 'assistant_message', message: { usage: { inputTokens: 20, outputTokens: 8 } } },
        { type: 'result', sessionId: 's2', usage: { inputTokens: 20, outputTokens: 8 }, contextSize: 28 },
      ];
      return [{ prompt: 'queued follow-up' }];
    };
    const attach = vi.spyOn(deps.chatService as unknown as { attachTurnUsage: (...a: unknown[]) => void }, 'attachTurnUsage');

    await runAgentTurn(deps, makeInput());

    expect(hoisted.executes).toHaveLength(2);
    const calls = attach.mock.calls as Array<[string, number, { outputTokens: number }]>;
    expect(calls.map(([, , u]) => u.outputTokens)).toEqual([5]);
  });

  /**
   * A task abandoned by cap expiry or abort NEVER receives
   * `background_task_completed` — the contract has no failed/aborted variant. Its
   * row would otherwise read `running` forever, so after a reload the panel would
   * assert something false rather than merely lose detail.
   */
  it('finalizes still-running background tasks once the generator is exhausted', async () => {
    hoisted.events = [
      { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'sleep 900' },
      // Generator ends with bg1 still in flight — no completion event ever comes.
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const cs = deps.chatService as unknown as {
      finalizeRunningBackgroundTasks: (...a: unknown[]) => void;
    };
    const finalize = vi.spyOn(cs, 'finalizeRunningBackgroundTasks');

    await runAgentTurn(deps, makeInput());

    expect(finalize).toHaveBeenCalledWith('t1');
  });
});

/**
 * The background-task family driven through the REAL `chat_background_task`
 * statements: the stubbed `chatService` above proves the calls, this proves
 * what the turn leaves in the table once it has closed.
 */
describe('runAgentTurn — background tasks persisted in chat_background_task', () => {
  let db: Database.Database;
  let real: ChatService;
  let threadId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    real = new ChatService(db);
    threadId = real.createThread('t').id;
  });
  afterEach(() => db.close());

  /** The stub rig, with the background-task family routed to the real service. */
  const rig = () => {
    const { deps } = makeDeps();
    const cs = deps.chatService as unknown as Record<string, unknown>;
    cs.startBackgroundTask = real.startBackgroundTask.bind(real);
    cs.updateBackgroundTaskProgress = real.updateBackgroundTaskProgress.bind(real);
    cs.completeBackgroundTask = real.completeBackgroundTask.bind(real);
    cs.finalizeRunningBackgroundTasks = real.finalizeRunningBackgroundTasks.bind(real);
    const input = makeInput();
    input.thread = { ...input.thread, id: threadId } as AgentTurnInput['thread'];
    return { deps, input };
  };

  const rows = () =>
    db
      .prepare(`SELECT task_id, status FROM chat_background_task WHERE thread_id = ? ORDER BY task_id`)
      .all(threadId) as Array<{ task_id: string; status: string }>;

  it('[ac:ac-dwa-rownolegle-zadania-w-tle-w-jednej] two parallel background tasks of one turn are stored as two chat_background_task rows, each under its own taskId', async () => {
    hoisted.events = [
      { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'npm run build' },
      { type: 'background_task_started', taskId: 'bg2', taskType: 'monitor', description: 'watch logs' },
      { type: 'background_task_progress', taskId: 'bg2', taskType: 'monitor', description: 'still watching' },
      { type: 'background_task_completed', taskId: 'bg1', taskType: 'shell', status: 'success' },
      { type: 'background_task_completed', taskId: 'bg2', taskType: 'monitor', status: 'success' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, input } = rig();

    await runAgentTurn(deps, input);

    expect(rows()).toEqual([
      { task_id: 'bg1', status: 'success' },
      { task_id: 'bg2', status: 'success' },
    ]);
  });

  it('[ac:ac-zadanie-ktore-nigdy-nie-dostalo-backg] a background task that never got background_task_completed has an abandoned row once the turn closes', async () => {
    hoisted.events = [
      { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'sleep 900' },
      { type: 'background_task_started', taskId: 'bg2', taskType: 'shell', description: 'npm run build' },
      { type: 'background_task_completed', taskId: 'bg2', taskType: 'shell', status: 'success' },
      // The generator ends with bg1 still in flight — its completion never comes.
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, input } = rig();

    await runAgentTurn(deps, input);

    // Only the unsettled task is closed out; a real outcome is not overwritten.
    expect(rows()).toEqual([
      { task_id: 'bg1', status: 'abandoned' },
      { task_id: 'bg2', status: 'success' },
    ]);
  });

  it('[ac:ac-pole-outputfile-renderuje-sie-jako-ni] the app neither reads nor tails the file a background task names in outputFile — it stores the path only', async () => {
    const { default: fs } = await import('node:fs');
    const os = await import('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bg-output-'));
    const outputFile = path.join(dir, 'bg1.log');
    const MARKER = 'BG-OUTPUT-NEVER-READ-7f3a';
    fs.writeFileSync(outputFile, MARKER);
    // Every fs entry point that could read or follow the file. Spied through, so
    // the rest of the turn (config, prompt) still reads what it needs; only a call
    // naming THIS path counts.
    const spies = [
      vi.spyOn(fs, 'readFileSync'),
      vi.spyOn(fs, 'readFile'),
      vi.spyOn(fs, 'createReadStream'),
      vi.spyOn(fs, 'openSync'),
      vi.spyOn(fs, 'open'),
      vi.spyOn(fs, 'watch'),
      vi.spyOn(fs, 'watchFile'),
      vi.spyOn(fs.promises, 'readFile'),
      vi.spyOn(fs.promises, 'open'),
    ];
    hoisted.events = [
      { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'npm run build' },
      { type: 'background_task_progress', taskId: 'bg1', taskType: 'shell', description: 'building', outputFile },
      { type: 'background_task_completed', taskId: 'bg1', taskType: 'shell', status: 'success', outputFile },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, input } = rig();
    const emitted: Array<Record<string, unknown>> = [];
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    let touched: unknown[][] = [];
    try {
      await runAgentTurn(deps, input);
      touched = spies.flatMap((spy) =>
        (spy.mock.calls as unknown[][]).filter((args) => String(args[0]) === outputFile),
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }

    expect(touched).toEqual([]);
    // The path is kept as data, and the file's content is nowhere — not on the
    // stream, not in the stored task.
    const stored = real.listBackgroundTasks(threadId);
    expect(stored.map((t) => t.outputFile)).toEqual([outputFile]);
    expect(JSON.stringify(stored)).not.toContain(MARKER);
    expect(JSON.stringify(emitted)).not.toContain(MARKER);
  });
});

/**
 * 0.2.109 — end of turn is read from the class and position of events, never
 * from the `result` payload. A live subagent delegation keeps the run open
 * after a `result` that carries no `backgroundTasks` at all.
 */
describe('runAgentTurn — 0.2.109 delegation holds the turn open', () => {
  const DELEGATION: Array<Record<string, unknown>> = [
    { type: 'text_delta', text: 'Delegating. ' },
    { type: 'subagent_started', taskId: 'sub_1', description: 'Explore M05', toolUseId: 'tool_q' },
    // Byte-for-byte a terminal result — no backgroundTasks — but NOT the end.
    { type: 'result', sessionId: 's-parked', usage: { inputTokens: 5, outputTokens: 2 }, contextSize: 192 },
    { type: 'subagent_completed', taskId: 'sub_1', status: 'completed' },
    { type: 'text_delta', text: 'The subagent reported back.' },
    { type: 'result', sessionId: 's-final', usage: { inputTokens: 9, outputTokens: 4 }, contextSize: 210 },
  ];

  it('[ac:ac-event-result-bez-backgroundtasks-wyem] a result without backgroundTasks during a live delegation does not close the SSE stream', async () => {
    hoisted.events = DELEGATION;
    const { deps } = makeDeps();
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    const result = await runAgentTurn(deps, input);

    const types = emitted.map((e) => e.type);
    // The wire of the brief: subagent_started, result, subagent_completed,
    // turn_start (continuation, same stream), …, result, done.
    expect(types.filter((t) => ['subagent_started', 'result', 'subagent_completed', 'turn_start', 'done'].includes(t as string))).toEqual([
      'subagent_started',
      'result',
      'subagent_completed',
      'turn_start',
      'result',
      'done',
    ]);
    expect(result.answer).toBe('The subagent reported back.');
  });

  it('[ac:ac-subagent-nigdy-nie-pojawia-sie-w-resu] the subagent never appears in result.backgroundTasks, and has its own lifecycle events', async () => {
    hoisted.events = DELEGATION;
    const { deps } = makeDeps();
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    for (const r of emitted.filter((e) => e.type === 'result')) {
      expect((r.backgroundTasks as unknown[] | undefined) ?? []).toEqual([]);
    }
    expect(emitted.some((e) => String(e.type).startsWith('background_task_'))).toBe(false);
    expect(emitted.filter((e) => e.type === 'subagent_completed')).toHaveLength(1);
  });

  it('the continuation turn_start reuses the iteration ids and lands in the replay after the result', async () => {
    hoisted.events = DELEGATION;
    const { deps } = makeDeps();
    let replaySnapshot: Array<{ type: string }> = [];
    let replayTurnStart: Record<string, unknown> | null = null;
    hoisted.beforeEvent = (event) => {
      if (event.type === 'text_delta' && event.text === 'The subagent reported back.') {
        // Right before the continuation's first delta is consumed.
        const active = (deps.activeAdapters as Map<string, { replay: { events: Array<{ type: string }>; turnStart: Record<string, unknown> } }>).get('t1')!;
        replaySnapshot = [...active.replay.events];
        replayTurnStart = active.replay.turnStart;
      }
    };
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    const cont = emitted.find((e) => e.type === 'turn_start')!;
    expect(cont.assistantMessageId).toBe(replayTurnStart!.assistantMessageId);
    expect(cont.userMessageId).toBe(replayTurnStart!.userMessageId);
    // The replay still carries the parked segment (result, subagent_completed)
    // for a joiner — the continuation belongs to the same user prompt.
    expect(replaySnapshot.map((e) => e.type)).toEqual(
      expect.arrayContaining(['subagent_started', 'result', 'subagent_completed']),
    );
  });

  it('withholds the continuation turn_start once a mid-turn user_message was pushed in the iteration', async () => {
    // agent-chat opened a fresh assistant message for the push under an id the
    // server never learns; a turn_start with the iteration's original id would
    // read there as "a turn already on disk" and tear the live stream down.
    hoisted.events = [
      { type: 'text_delta', text: 'Delegating. ' },
      { type: 'subagent_started', taskId: 'sub_1', description: 'Explore M05', toolUseId: 'tool_q' },
      { type: 'result', sessionId: 's-parked', usage: { inputTokens: 5, outputTokens: 2 }, contextSize: 192 },
      { type: 'user_message', text: 'pushed while parked', timestamp: Date.now() },
      { type: 'subagent_completed', taskId: 'sub_1', status: 'completed' },
      { type: 'text_delta', text: 'The subagent reported back.' },
      { type: 'result', sessionId: 's-final', usage: { inputTokens: 9, outputTokens: 4 }, contextSize: 210 },
    ];
    const { deps } = makeDeps();
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    expect(emitted.filter((e) => e.type === 'turn_start')).toHaveLength(0);
    expect(emitted.at(-1)?.type).toBe('done');
  });

  it('[ac:ac-watek-ktorego-tura-po-result-czeka-wy] a thread whose turn waits only on a delegation after result stays live (activeAdapters → isLive)', async () => {
    hoisted.events = DELEGATION;
    const { deps } = makeDeps();
    const liveAfterResult: boolean[] = [];
    let sawParkedResult = false;
    hoisted.beforeEvent = (event) => {
      if (sawParkedResult) liveAfterResult.push(deps.activeAdapters.has('t1'));
      if (event.type === 'result' && event.sessionId === 's-parked') sawParkedResult = true;
    };

    await runAgentTurn(deps, makeInput());

    expect(liveAfterResult.length).toBeGreaterThan(0);
    expect(liveAfterResult.every(Boolean)).toBe(true);
    expect(deps.activeAdapters.has('t1')).toBe(false);
  });

  it('[ac:ac-w-watku-dziecku-zywa-delegacja-do-sub] in a child thread (runTransagent) a live delegation keeps the turn open after result', async () => {
    hoisted.events = DELEGATION;
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as { parentThreadId: string | null }).parentThreadId = 'parent-1';

    const result = await runAgentTurn(deps, input);

    // The bubble's summary is the text after the delegation — i.e. taken once
    // the generator is exhausted, not at the first `result`.
    expect(result.answer).toBe('The subagent reported back.');
    const cfg = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(cfg.claude_disallowBackgroundBash).toBe(true);
  });

  it('[ac:ac-zadanie-ask-pozostaje-otwarte-dopoki] an ask turn stays open while its delegation lives', async () => {
    hoisted.events = DELEGATION;
    const { deps } = makeDeps();
    let settled = false;
    const settledAtEvent: boolean[] = [];
    hoisted.beforeEvent = () => settledAtEvent.push(settled);
    const input = { ...makeInput(), timeoutMs: 15 * 60_000 };
    (input.thread as { contextType: string }).contextType = 'ask';

    const result = await runAgentTurn(deps, input).then((r) => {
      settled = true;
      return r;
    });

    expect(settledAtEvent.every((s) => s === false)).toBe(true);
    expect(result.answer).toBe('The subagent reported back.');
  });

  it('closes still-running delegations as abandoned once the generator is exhausted', async () => {
    hoisted.events = [
      { type: 'subagent_started', taskId: 'sub_1', description: 'x' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const cs = deps.chatService as unknown as { finalizeRunningSubagentTasks: (...a: unknown[]) => void };
    const finalize = vi.spyOn(cs, 'finalizeRunningSubagentTasks');

    await runAgentTurn(deps, makeInput());

    expect(finalize).toHaveBeenCalledWith('t1');
  });

  describe('hold expiry', () => {
    const expired = (events: Array<Record<string, unknown>>) => [
      ...events,
      { type: 'error', error: new AdapterBackgroundHoldExpiredError('claude-code', 300_000), phase: 'runtime' },
    ];

    it('[ac:ac-delegacja-trwajaca-dluzej-niz-cap-hol] a delegation that outlives the cap ends the turn with BACKGROUND_HOLD_EXPIRED, with no background task in the turn', async () => {
      hoisted.events = expired([
        { type: 'subagent_started', taskId: 'sub_1', description: 'slow' },
        { type: 'result', sessionId: 's1' },
      ]);
      const { deps } = makeDeps();

      await expect(runAgentTurn(deps, makeInput())).rejects.toMatchObject({
        code: 'BACKGROUND_HOLD_EXPIRED',
      });
    });

    it('[ac:ac-przekroczenie-capa-oczekiwania-na-zad] background tasks outliving the hold cap end the turn with a terminal error carrying AdapterBackgroundHoldExpiredError as BACKGROUND_HOLD_EXPIRED', async () => {
      hoisted.events = expired([
        { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'sleep 900' },
        { type: 'result', sessionId: 's1', backgroundTasks: [{ taskId: 'bg1', taskType: 'shell' }] },
      ]);
      const { deps } = makeDeps();
      const emitted: Array<Record<string, unknown>> = [];
      const input = makeInput();
      input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

      await expect(runAgentTurn(deps, input)).rejects.toMatchObject({
        name: 'AgentTurnError',
        code: 'BACKGROUND_HOLD_EXPIRED',
      });

      // One typed error frame on the wire, carrying the hold-expiry code…
      const errors = emitted.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: 'BACKGROUND_HOLD_EXPIRED' });
      expect(errors[0]!.error).toContain('1 background task(s)');
      // …and it is terminal: nothing but `done` follows it.
      expect(emitted.slice(emitted.indexOf(errors[0]!) + 1).map((e) => e.type)).toEqual(['done']);
    });

    it('[ac:ac-komunikat-wygasniecia-holdu-podaje-li] the message counts abandoned delegations from subagent_started minus subagent_completed', async () => {
      hoisted.events = expired([
        { type: 'subagent_started', taskId: 'sub_1', description: 'a' },
        { type: 'subagent_started', taskId: 'sub_2', description: 'b' },
        { type: 'subagent_started', taskId: 'sub_3', description: 'c' },
        { type: 'subagent_completed', taskId: 'sub_2', status: 'completed' },
        { type: 'result', sessionId: 's1' },
      ]);
      const { deps } = makeDeps();

      const err = await runAgentTurn(deps, makeInput()).catch((e: Error) => e);

      expect((err as Error).message).toContain('2 subagent delegation(s)');
      expect((err as Error).message).not.toContain('background task');
    });

    it('names each non-empty registry separately, never a sum', async () => {
      hoisted.events = expired([
        { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'sleep' },
        { type: 'subagent_started', taskId: 'sub_1', description: 'a' },
        { type: 'result', sessionId: 's1', backgroundTasks: [{ taskId: 'bg1', taskType: 'shell' }] },
      ]);
      const { deps } = makeDeps();

      const err = await runAgentTurn(deps, makeInput()).catch((e: Error) => e);

      expect((err as Error).message).toContain('1 background task(s) and 1 subagent delegation(s)');
    });

    it('[ac:ac-komunikat-wygasniecia-holdu-przy-obu] with both registries empty the message carries no count', async () => {
      hoisted.events = expired([{ type: 'result', sessionId: 's1' }]);
      const { deps } = makeDeps();

      const err = await runAgentTurn(deps, makeInput()).catch((e: Error) => e);

      expect((err as Error).message).toBe('background hold expired after 300000ms with no recognized cause');
      // The only number is the cap itself — no task or delegation count.
      expect((err as Error).message.replace('300000ms', '')).not.toMatch(/\d/);
    });
  });
});

describe('runAgentTurn — 0.2.50 turn-lifecycle contract', () => {
  /**
   * 2.1.51: `adapter_ready` is forwarded live and never replayed. The wire copy
   * carries the adapter name only — `sdkConfig` holds `custom_env` with a
   * decrypted API key.
   */
  it('forwards adapter_ready live as a name-only frame and keeps it out of the replay', async () => {
    hoisted.events = [
      {
        type: 'adapter_ready',
        adapter: 'claude-code',
        sdkConfig: { custom_env: { ANTHROPIC_API_KEY: 'sk-ant-super-secret' } },
      },
      { type: 'text_delta', text: 'hi' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const activeAdapters = new Map();
    (deps as unknown as { activeAdapters: Map<string, unknown> }).activeAdapters = activeAdapters;
    let replaySnapshot: Array<Record<string, unknown>> = [];
    hoisted.beforeEvent = () => {
      const active = activeAdapters.get('t1') as { replay: { events: unknown[] } } | undefined;
      if (active) replaySnapshot = active.replay.events as Array<Record<string, unknown>>;
    };
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);
    hoisted.beforeEvent = null;

    const ready = emitted.filter((e) => e.type === 'adapter_ready');
    expect(ready).toEqual([{ type: 'adapter_ready', adapter: 'claude-code' }]);
    // Before the first text of the turn, never after it.
    expect(emitted.indexOf(ready[0]!)).toBeLessThan(emitted.findIndex((e) => e.type === 'text_delta'));
    expect(JSON.stringify(emitted)).not.toContain('sk-ant-super-secret');
    expect(replaySnapshot.some((e) => e.type === 'adapter_ready')).toBe(false);
  });

  /**
   * A refusal the adapter DELIVERS (`AdapterToolPolicyError`) is still exactly
   * `error` + `done` on the wire: the held `adapter_ready` is dropped.
   */
  it('[ac:ac-odmowa-polityki-narzedzi-produkuje-st] a tool-policy refusal (error, phase init) is a stream of one error and done, with no adapter_ready and no result', async () => {
    hoisted.events = [
      { type: 'adapter_ready', adapter: 'claude-code', sdkConfig: {} },
      {
        type: 'error',
        error: new AdapterToolPolicyError('claude-code', {
          unenforceable: ['shell'],
          unknownGroups: [],
          enforceable: [],
        }),
        phase: 'init',
      },
    ];
    const { deps } = makeDeps();
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await expect(runAgentTurn(deps, input)).rejects.toMatchObject({ code: 'TOOL_POLICY_REFUSED' });

    // `connected` is the transport's opening frame, not a turn event. Exactly one
    // `error` and `done` — so neither `adapter_ready` nor `result` is on the wire.
    expect(emitted.map((e) => e.type).filter((t) => t !== 'connected')).toEqual(['error', 'done']);
    expect(emitted.find((e) => e.type === 'error')).toMatchObject({ code: 'TOOL_POLICY_REFUSED' });
  });

  /**
   * `sdkConfig` is library-shaped and carries `custom_env`, which holds a
   * DECRYPTED api key whenever the project uses a stored credential. Logging it
   * verbatim would write a live credential to disk in plaintext.
   */
  it('never logs a raw secret from adapter_ready sdkConfig', async () => {
    hoisted.events = [
      {
        type: 'adapter_ready',
        adapter: 'claude-code',
        sdkConfig: { custom_env: { ANTHROPIC_API_KEY: 'sk-ant-super-secret' } },
      },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await runAgentTurn(deps, makeInput());
    spy.mockRestore();

    const all = logged.join('\n');
    expect(all).not.toContain('sk-ant-super-secret');
    // The key NAME still shows — which env vars were set is useful and is not
    // itself the secret.
    expect(all).toContain('ANTHROPIC_API_KEY');
  });

  /**
   * A `warning` arriving AFTER the final `result` is legal: its position on the
   * stream carries no meaning. It must be accepted normally rather than treated
   * as a protocol error or as a second end-of-turn.
   */
  it('[ac:ac-zdarzenie-warning-ktore-przyszlo-po-o] a warning that arrives after the terminal result is persisted in the thread, not rejected and not a second end of turn', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'answer' },
      { type: 'result', sessionId: 's1' },
      { type: 'warning', message: 'scope degraded to soft enforcement' },
    ];
    const { deps, messages } = makeDeps();
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    // Resolves — no protocol error is thrown for the late event.
    const result = await runAgentTurn(deps, input);

    expect(result.answer).toBe('answer');
    // Persisted as its own `warning` row of the thread, after the answer.
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'warning']);
    expect(emitted.filter((e) => e.type === 'warning')).toHaveLength(1);
    // Neither a protocol error nor an end of turn: no `error` event, and the
    // stream's single `done` comes after the warning, not before it.
    expect(emitted.filter((e) => e.type === 'error')).toHaveLength(0);
    const types = emitted.map((e) => e.type);
    expect(types.filter((t) => t === 'done')).toHaveLength(1);
    expect(types.indexOf('warning')).toBeLessThan(types.indexOf('done'));
  });

  /**
   * `flush` is side-band too: an empty-payload context-compaction boundary. It
   * must not crash the loop and must not end the turn.
   */
  it('tolerates a flush event mid-turn without ending the turn', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'before ' },
      { type: 'flush' },
      { type: 'text_delta', text: 'after' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();

    const result = await runAgentTurn(deps, makeInput());

    expect(result.answer).toBe('before after');
  });

  /**
   * `UnifiedEvent` grows between library releases. An unknown member must be an
   * inert no-op, not an exception thrown from inside the turn loop.
   */
  it('ignores an unknown future event type instead of throwing', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'ok' },
      { type: 'hold_heartbeat', heldForMs: 1000 },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();

    await expect(runAgentTurn(deps, makeInput())).resolves.toMatchObject({ answer: 'ok' });
  });

  /**
   * A mid-turn push is persisted where the ADAPTER emitted `user_message`, not
   * where `pushMessage()` was called. The two differ: the SDK accepts the push
   * immediately but only surfaces the message once it actually reaches the
   * model. Ordering by the call site would leave the thread's row order
   * disagreeing with the order the model saw them in.
   */
  it('[ac:ac-wiadomosc-dostarczona-mid-turn-jest-p] persists a mid-turn user_message in STREAM order, not push order', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'first half ' },
      // The push happened earlier; the adapter surfaces it HERE.
      { type: 'user_message', text: 'pushed mid-turn', timestamp: Date.now() },
      { type: 'text_delta', text: 'second half' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, messages } = makeDeps();

    await runAgentTurn(deps, makeInput());

    const roles = messages.map((m) => m.role);
    const userIdx = roles.lastIndexOf('user');
    const assistantIdxs = roles.flatMap((r, i) => (r === 'assistant' ? [i] : []));
    // The pushed user row sits BETWEEN the two assistant blocks — i.e. exactly
    // where the adapter emitted it, not before the turn's first text.
    expect(assistantIdxs.some((i) => i < userIdx)).toBe(true);
    expect(assistantIdxs.some((i) => i > userIdx)).toBe(true);
  });

  /**
   * `ask` is headless and blocks its HTTP request until the turn ends — there is
   * no UI in which a hold could be shown, so background work is switched off.
   */
  it('[ac:ac-w-watku-o-context-type-ask-oraz-w-kaz] disallows background bash for an ask-context turn', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as { contextType: string }).contextType = 'ask';

    await runAgentTurn(deps, input);

    const cfg = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(cfg.claude_disallowBackgroundBash).toBe(true);
  });

  /**
   * A transagent bubble must stay blocking and terminal — detach mode is
   * deliberately absent in v1. Without this flag a child's `result` could carry
   * `backgroundTasks` and break that decision as a side effect of the upgrade.
   */
  it('[ac:ac-w-watku-o-context-type-ask-oraz-w-kaz] disallows background bash for a child thread regardless of context type', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as { parentThreadId: string | null }).parentThreadId = 'parent-1';

    await runAgentTurn(deps, input);

    const cfg = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(cfg.claude_disallowBackgroundBash).toBe(true);
  });

  /**
   * 0.2.53: a top-level chat turn keeps background work available only where the
   * project left `agent.disableDirectFilesystemAccess` off. With the flag on —
   * the DEFAULT — the `shell` group is denied, so a background shell is not a
   * capability this turn has, and starting one is blocked at the source rather
   * than failing later.
   */
  it('leaves background bash enabled for a top-level chat turn when direct FS access is allowed', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    hoisted.agent = { disableDirectFilesystemAccess: false };
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    const cfg = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(cfg.claude_disallowBackgroundBash).toBeUndefined();
  });

  it('disallows background bash for a top-level chat turn under the default posture', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    const cfg = hoisted.lastExecute?.architectureConfig as Record<string, unknown>;
    expect(cfg.claude_disallowBackgroundBash).toBe(true);
  });
});

/**
 * 0.2.50 — the replay buffer is unbounded RAM held for the whole turn, and a
 * turn that reads many large files can push tens of MB of `tool_result`
 * summaries through it.
 */
describe('runAgentTurn — replay buffer byte budget', () => {
  /** One 1 MB tool_result payload; five of them clear the 4 MB budget. */
  const bigResult = (id: string) => ({
    type: 'tool_result',
    toolUseId: id,
    toolName: 'Read',
    summary: 'x'.repeat(1024 * 1024),
    isSubagent: false,
  });

  it('[ac:ac-bufor-replay-przekraczajacy-budzet-ba] degrades the oldest tool_result entries to a header instead of dropping them', async () => {
    const toolUse = (id: string) => ({ type: 'tool_use', toolUseId: id, toolName: 'Read', input: {}, isSubagent: false });
    hoisted.events = [
      toolUse('tu-1'),
      bigResult('tu-1'),
      toolUse('tu-2'),
      bigResult('tu-2'),
      toolUse('tu-3'),
      bigResult('tu-3'),
      toolUse('tu-4'),
      bigResult('tu-4'),
      toolUse('tu-5'),
      bigResult('tu-5'),
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const activeAdapters = new Map();
    (deps as unknown as { activeAdapters: Map<string, unknown> }).activeAdapters = activeAdapters;

    let replaySnapshot: Array<Record<string, unknown>> = [];
    hoisted.beforeEvent = () => {
      const active = activeAdapters.get('t1') as { replay: { events: unknown[] } } | undefined;
      if (active) replaySnapshot = active.replay.events as Array<Record<string, unknown>>;
    };

    await runAgentTurn(deps, makeInput());
    hoisted.beforeEvent = null;

    const toolResults = replaySnapshot.filter((e) => e.type === 'tool_result');
    // NOTHING is removed — a dropped `tool_result` would leave the paired
    // `tool_use` card spinning forever in a joiner's reducer, because the card
    // closes on the RESULT. Degraded still closes it, just without a body.
    expect(toolResults).toHaveLength(5);

    const degraded = toolResults.filter((e) => e.truncated === true);
    expect(degraded.length).toBeGreaterThan(0);
    // A degraded entry loses its PAYLOAD and keeps every routing field. Dropping
    // `isSubagent`/`subagentTaskId` would make a joiner append a subagent's
    // result to the main transcript and leave the subagent card spinning — the
    // very failure degradation exists to prevent — and dropping `isError` would
    // replay a failed tool as a successful one.
    for (const entry of degraded) {
      expect(entry.toolUseId).toBeTruthy();
      expect(entry.summary).toBe('');
      expect(entry).toHaveProperty('isSubagent');
    }
    // 2.1.51: the header names the tool — taken from the paired `tool_use`,
    // since the adapter's `tool_result` carries no name.
    expect(degraded[0]!.toolName).toBe('Read');
    // Oldest-first: the newest result is the one a joiner most likely still wants.
    expect(toolResults[0].truncated).toBe(true);
    expect(toolResults[toolResults.length - 1].truncated).toBeUndefined();
  });

  /**
   * Degrading the replay buffer must never reach into what gets PERSISTED.
   *
   * The whole design rests on "the full content stays recoverable from
   * `chat_message` after the turn". `emit` runs before the persistence switch
   * and degradation mutates in place, so buffering the live object would let a
   * budget overflow blank the very row that makes the degradation safe — the
   * cap would quietly destroy the copy it promises to fall back on.
   */
  it('never lets replay degradation blank the persisted tool_result row', async () => {
    // A SINGLE result larger than the whole budget is the case that bites:
    // degrading every older entry still leaves the buffer over, so the sweep
    // reaches the newest entry — the one the persistence switch has not read
    // yet. Five 1MB results do NOT reproduce it: degrading the first is enough
    // to get back under, so the newest is never touched.
    const payload = 'y'.repeat(5 * 1024 * 1024);
    hoisted.events = [
      { type: 'tool_result', toolUseId: 'tu-1', toolName: 'Read', summary: payload, isSubagent: false },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    // `messages` drops `content`; the row store keeps it, and content is the
    // whole point here.
    const stored = (
      deps.chatService as unknown as { getMessages: () => Array<{ role: string; content: string }> }
    ).getMessages();
    const rows = stored.filter((m) => m.role === 'tool_result');
    expect(rows).toHaveLength(1);
    // Every persisted row still carries its full body, however hard the replay
    // buffer had to degrade to stay under budget.
    for (const row of rows) {
      const parsed = JSON.parse(row.content) as { summary?: string };
      expect(parsed.summary).toBeTruthy();
      expect(parsed.summary).toHaveLength(payload.length);
    }
  });
});

/**
 * C21 — the adapter's `warning` event is the ONLY channel reporting a weakened
 * runtime guarantee: an FS scope that fell back from a hard OS sandbox to a soft
 * one, an execute param this architecture ignores. It used to reach a
 * `console.warn` on the server and nothing else — forwarded over SSE, but
 * swallowed by a client with no branch for it, absent from the replay buffer and
 * never written to history. A security notice nobody can see is not a notice.
 */
describe('runAgentTurn — adapter warnings reach the user (C21)', () => {
  it('[ac:ac-zdarzenie-warning-z-adaptera-jest-for] persists a warning as its own complete row, forwards it to the client and keeps it in the replay buffer', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'Starting. ' },
      { type: 'warning', message: 'filesystem scope degraded to soft enforcement' },
      { type: 'text_delta', text: 'Done.' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, messages } = makeDeps();
    // The buffer dies with the turn's registry entry, so read it while the turn
    // is still running — right before its last event.
    let replayed: Array<Record<string, unknown>> = [];
    hoisted.beforeEvent = (event) => {
      if (event.type !== 'result') return;
      const active = (deps.activeAdapters as Map<string, { replay: { events: Array<Record<string, unknown>> } }>).get('t1')!;
      replayed = [...active.replay.events];
    };
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    const warnings = messages.filter((m) => m.role === 'warning');
    expect(warnings).toHaveLength(1);

    // Content is `{ message }`, not `{ text }` — the row is a warning, not prose.
    const row = (deps.chatService as unknown as { getMessages: () => Array<{ role: string; content: string }> })
      .getMessages()
      .find((r) => r.role === 'warning');
    expect(JSON.parse(row!.content)).toEqual({
      message: 'filesystem scope degraded to soft enforcement',
    });

    // It still reaches the live client too.
    expect(emitted.filter((e) => e.type === 'warning')).toHaveLength(1);
    // And a joiner gets it from the replay buffer, like every other turn event.
    expect(replayed.filter((e) => e.type === 'warning')).toEqual([
      { type: 'warning', message: 'filesystem scope degraded to soft enforcement' },
    ]);
  });

  it('lands between the assistant blocks it interrupted, not after the turn', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'Before. ' },
      { type: 'warning', message: 'execute param ignored by this architecture' },
      { type: 'text_delta', text: 'After.' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, messages } = makeDeps();

    await runAgentTurn(deps, makeInput());

    // The preceding assistant buffer is flushed first, so ordering in history
    // matches when the guarantee actually weakened.
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'warning', 'assistant']);
    expect(messages[1]!.text).toBe('Before. ');
    expect(messages[3]!.text).toBe('After.');
  });
});

/**
 * Brief `0-2-35-to-next` — a failed MCP mount must be loud and fatal.
 *
 * The production signature these pin: `tool_use` and `tool_result` in the same
 * second, `{"summary":"(mcp__brief-tools__update_brief completed with no
 * output)"}`, the handler never entered, and nobody — model or user — told
 * anything. The SDK swallows a rejected `connect()` and advertises the server
 * anyway, so the turn has to notice on its own.
 */
describe('runAgentTurn — mounting is loud (0-2-35-to-next)', () => {
  /** Marks every mounted server bound, as a healthy SDK connect would. */
  function bindAll(opts: Record<string, unknown>): void {
    for (const config of Object.values((opts.mcpServers ?? {}) as Record<string, { instance?: unknown }>)) {
      const instance = config.instance as { server?: { transport?: unknown } } | undefined;
      if (instance) instance.server = { transport: {} };
    }
  }

  /** Binds everything EXCEPT `except` — one server dark among healthy ones. */
  function bindAllExcept(except: string) {
    return (opts: Record<string, unknown>): void => {
      const servers = (opts.mcpServers ?? {}) as Record<string, { instance?: unknown }>;
      for (const [name, config] of Object.entries(servers)) {
        const instance = config.instance as { server?: { transport?: unknown } } | undefined;
        if (instance) instance.server = { transport: name === except ? undefined : {} };
      }
    };
  }

  /** A turn whose single MCP call comes back with nothing — the observed defect. */
  function emptyMcpCallEvents(toolName = 'mcp__plan-tools__update_plan') {
    return [
      { type: 'tool_use', toolName, toolUseId: 'u1', input: {} },
      {
        type: 'tool_result',
        toolUseId: 'u1',
        summary: `(${toolName} completed with no output)`,
        isError: false,
      },
      { type: 'result', sessionId: 's1' },
    ];
  }

  it('an empty MCP tool_result with every server unbound kills the turn (signature B)', async () => {
    hoisted.events = emptyMcpCallEvents();
    // No onExecute: nothing ever binds, exactly like a whole set going dark.
    const { deps } = makeDeps();

    await expect(runAgentTurn(deps, makeInput())).rejects.toThrow(/whole mounted set is dark/i);
  });

  it('distinguishes ONE dark server from the whole set going dark (signature A vs B)', async () => {
    hoisted.events = emptyMcpCallEvents();
    hoisted.onExecute = bindAllExcept('plan-tools');
    const { deps } = makeDeps();

    // Signature A names the single server and says the others mounted cleanly —
    // the "indistinguishable from the outside" half of the defect.
    const err = await runAgentTurn(deps, makeInput()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/"plan-tools" is advertised but never bound/);
    expect((err as Error).message).toMatch(/other server\(s\) mounted cleanly/);
    expect((err as Error).message).not.toMatch(/whole mounted set is dark/i);
  });

  it('blames the server the call named, not a healthy bystander', async () => {
    // An empty result from brief-tools says nothing about release-tools. Blaming
    // a bystander is how this failure stayed unreadable in the first place.
    hoisted.events = emptyMcpCallEvents('mcp__c4s-tools__ask');
    hoisted.onExecute = bindAllExcept('plan-tools');
    const { deps } = makeDeps();

    // plan-tools is dark, but the call went to c4s-tools, which is bound.
    await expect(runAgentTurn(deps, makeInput())).resolves.toBeDefined();
  });

  it('survives the SDK tearing its transports down while events still drain', async () => {
    // `Query.cleanup()` closes every sdk transport and clears the map, so after
    // a query ends EVERY instance reads as unbound. A late empty tool_result
    // must not be mistaken for a total mount failure and kill a turn that
    // already succeeded.
    hoisted.events = emptyMcpCallEvents();
    hoisted.onExecute = bindAll;
    // The call is issued while everything is bound; the SDK tears the transports
    // down before its result reaches us.
    hoisted.beforeEvent = (event, opts) => {
      if (event.type !== 'tool_result') return;
      for (const config of Object.values((opts.mcpServers ?? {}) as Record<string, { instance?: unknown }>)) {
        const instance = config.instance as { server?: { transport?: unknown } } | undefined;
        if (instance?.server) instance.server.transport = undefined;
      }
    };
    const { deps } = makeDeps();

    await expect(runAgentTurn(deps, makeInput())).resolves.toBeDefined();
  });

  it('a blank summary is not the no-output placeholder', async () => {
    // `tool_result.summary` carries the tool's full content and can legitimately
    // be empty; only the synthesized placeholder means "the handler never ran".
    hoisted.events = [
      { type: 'tool_use', toolName: 'mcp__plan-tools__update_plan', toolUseId: 'u1', input: {} },
      { type: 'tool_result', toolUseId: 'u1', summary: '', isError: false },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();

    await expect(runAgentTurn(deps, makeInput())).resolves.toBeDefined();
  });

  it('the error reaches the client as an `error` event, not just as a rejection', async () => {
    hoisted.events = emptyMcpCallEvents();
    const { deps } = makeDeps();
    const events: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => events.push(e as unknown as Record<string, unknown>);

    await runAgentTurn(deps, input).catch(() => {});

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent?.error)).toMatch(/MCP mount failed/);
  });

  it('leaves a healthy turn alone — bound servers, empty result, no abort', async () => {
    // An empty result with LIVE bindings is not a mount failure. Per-call
    // observability is deliberately another brief's subject; this must not
    // become a second, speculative failure mode.
    hoisted.events = emptyMcpCallEvents();
    hoisted.onExecute = bindAll;
    const { deps } = makeDeps();

    await expect(runAgentTurn(deps, makeInput())).resolves.toBeDefined();
  });

  it('never probes a healthy turn that makes no MCP call', async () => {
    // sdk-type servers connect lazily, so "unbound" is normal until a call has
    // to reach one. A turn with no MCP traffic must never trip the guard.
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await expect(runAgentTurn(deps, makeInput())).resolves.toBeDefined();
  });

  it('a non-MCP tool returning no output is not a mount failure', async () => {
    hoisted.events = [
      { type: 'tool_use', toolName: 'Bash', toolUseId: 'u1', input: {} },
      { type: 'tool_result', toolUseId: 'u1', summary: '(Bash completed with no output)', isError: false },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();

    await expect(runAgentTurn(deps, makeInput())).resolves.toBeDefined();
  });

  it('refuses to mount the same McpServer instance twice in one turn', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    // A memoizing factory: one instance handed out under two names. Mounting it
    // twice is the 'Already connected to a transport' rejection the SDK hides.
    const shared = { server: {} };
    (deps.pluginHost as unknown as { buildMcpServers: () => unknown }).buildMcpServers = () => [
      { name: 'entity-tools', server: { config: { type: 'sdk', name: 'entity-tools', instance: shared } } },
      { name: 'release-tools', server: { config: { type: 'sdk', name: 'release-tools', instance: shared } } },
    ];

    await expect(runAgentTurn(deps, makeInput())).rejects.toThrow(
      /SAME instance already mounted|already returned for another server/i,
    );
  });

  it('releases the thread when the mount fails — no 409 wedge, no pinned context', async () => {
    // The register/release pair now spans exactly one try/finally, so a throw
    // during setup can no longer strand an `activeAdapters` entry. A stranded
    // entry means `POST /api/chat` answers 409 STREAM_IN_PROGRESS for that
    // thread and `hasInFlightTurn()` pins the ProjectContext — until restart.
    hoisted.events = emptyMcpCallEvents();
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput()).catch(() => {});

    expect(deps.activeAdapters.size).toBe(0);
  });
});

/**
 * Brief `0-2-35-to-next` item 2 — L3's "the profile is the only hard gate" has
 * to be true of the WHOLE server map. The six inline servers used to be written
 * in after `gateServers` had run.
 */
describe('runAgentTurn — the profile gate covers the inline servers too', () => {
  async function mountedFor(contextType: string, patchPath: string | null = null): Promise<string[]> {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    // The rig is built without a workspace, and workspace-tools mounts only when
    // one is present — supply it, since it is the server these tests are about.
    (deps as unknown as { listWorkspaceProjects: () => unknown }).listWorkspaceProjects = () => ({
      projects: [],
    });
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = contextType;
    (input.thread as unknown as { patchPath: string | null }).patchPath = patchPath;
    await runAgentTurn(deps, input);
    return Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>).sort();
  }

  it('keeps the inline servers a profile admits — they pass THROUGH the gate, not around it', async () => {
    // Every inline tool's catalog opClass matches the coarse flag that mounts
    // its server, so routing them through the gate drops nothing.
    expect(await mountedFor('chat')).toEqual(
      ['c4s-tools', 'plan-tools', 'skill-tools', 'transagent-tools', 'workspace-tools'].sort(),
    );
  });

  it('0.2.36: skill-tools mounts in ALL FOUR context types, `brief` included', async () => {
    // The one server with no `ctx.mcp.*` dimension behind it and no catalog row.
    // `brief` is the case that matters: that frame runs with the FS built-ins off,
    // so `load_skill_file` is its ONLY route to a style's `workflows/brief.md`.
    for (const contextType of ['chat', 'brief', 'patch', 'ask']) {
      expect(await mountedFor(contextType)).toContain('skill-tools');
    }
  });

  it('[ac:ac-w-watku-context-type-brief-serwer-ski] a brief thread mounts skill-tools and advertises load_skill_file while its FS built-ins are denied — the one route to a style\'s workflows/brief.md', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    // Even a project that ALLOWS direct FS access gets no built-ins in a brief thread.
    hoisted.agent = { disableDirectFilesystemAccess: false };
    const { deps } = makeDeps();
    const input = makeInput();
    (input.thread as unknown as { contextType: string; briefPath: string }).contextType = 'brief';
    (input.thread as unknown as { contextType: string; briefPath: string }).briefPath = 'b.md';

    await runAgentTurn(deps, input);

    // No built-ins: Read/Glob/Grep (file-read) are off in this frame…
    expect(hoisted.lastExecute?.disallowedToolGroups as string[]).toContain('file-read');
    // …and skill-tools is mounted all the same, its tool named in the inventory.
    expect(Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>)).toContain('skill-tools');
    expect(String(hoisted.lastExecute?.systemPrompt)).toContain('<mcp name="skill-tools">load_skill_file</mcp>');
  });

  it('[ac:ac-w-turze-wewnetrznej-list-skills-nie-j] [ac:ac-w-turze-wewnetrznej-load-skill-file-j] 0.2.99: the turn gets load_skill_file and never list_skills, in every context type', async () => {
    // Mounting is per-server: a `list_skills` on the turn's skill-tools would reach
    // all four types at once, and the turn already has `<available_skills>`.
    for (const contextType of ['chat', 'brief', 'patch', 'ask']) {
      expect(await mountedFor(contextType)).toContain('skill-tools');
      const prompt = String(hoisted.lastExecute?.systemPrompt);
      expect(prompt).toContain('<mcp name="skill-tools">load_skill_file</mcp>');
      expect(prompt).not.toContain('list_skills');
      expect(JSON.stringify(hoisted.lastExecute?.allowedTools ?? [])).not.toContain('list_skills');
    }
  });

  it('workspace-tools survives the gate for every profile — list_projects is read-class; 2.1.57: brief included (M44 row)', async () => {
    for (const contextType of ['chat', 'ask', 'patch', 'brief']) {
      expect(await mountedFor(contextType)).toContain('workspace-tools');
    }
  });

  it('2.1.4: a patch thread mounts patch-tools (get_patch, mark_patch_applied) on top of chat\'s set — 2.1.18: minus transagent-tools', async () => {
    expect(await mountedFor('patch', 'p.md')).toEqual(
      ['c4s-tools', 'patch-tools', 'plan-tools', 'skill-tools', 'workspace-tools'].sort(),
    );
    expect(String(hoisted.lastExecute?.systemPrompt)).toContain(
      '<mcp name="patch-tools">get_patch, mark_patch_applied</mcp>',
    );
  });

  it('2.1.4: chat, brief and ask threads never mount patch-tools', async () => {
    for (const contextType of ['chat', 'brief', 'ask']) {
      expect(await mountedFor(contextType), contextType).not.toContain('patch-tools');
    }
  });

  it('ask still gets neither the peer nor the delegation server', async () => {
    // The recursion guard is a property of the profile, and it survives the move
    // of the inline servers to the gated side of the map.
    const mounted = await mountedFor('ask');
    expect(mounted).not.toContain('c4s-tools');
    expect(mounted).not.toContain('transagent-tools');
  });
});

/**
 * 2.1.18 (M44 `3f5ej79s`, M05 `iatop5pj`, M23 `jbcb06l2`) — `transagent-tools` is
 * mounted ONLY on a top-level `chat` thread (`parent_thread_id IS NULL`). The
 * `patch` thread lost it (and with it `runTransagent`) while keeping `c4s-tools`,
 * `spec-skill-tools` and `patch-tools`. The retired criterion
 * `ac-watki-context-type-chat-patch-maja-za` ("chat and patch both have
 * transagent-tools") is asserted nowhere.
 */
describe('runAgentTurn — transagent-tools only on a top-level chat thread (2.1.18)', () => {
  async function turnFor(
    contextType: string,
    opts: { patchPath?: string | null; parentThreadId?: string | null; briefPath?: string | null } = {},
  ): Promise<{ mounted: string[]; servers: Record<string, unknown>; prompt: string }> {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    (deps as unknown as { listWorkspaceProjects: () => unknown }).listWorkspaceProjects = () => ({ projects: [] });
    (deps as unknown as { specSkillTools: SpecSkillTools }).specSkillTools = new SpecSkillTools(
      { skillsRoot: () => undefined },
      'p1',
    );
    const input = makeInput();
    const thread = input.thread as unknown as {
      contextType: string;
      patchPath: string | null;
      parentThreadId: string | null;
      briefPath: string | null;
    };
    thread.contextType = contextType;
    thread.patchPath = opts.patchPath ?? null;
    thread.briefPath = opts.briefPath ?? null;
    thread.parentThreadId = opts.parentThreadId ?? null;
    await runAgentTurn(deps, input);
    const servers = (hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>;
    return { mounted: Object.keys(servers).sort(), servers, prompt: String(hoisted.lastExecute?.systemPrompt) };
  }

  it('[ac:ac-watek-context-type-chat-ma-zamontowan] a context_type=\'chat\' thread has c4s-tools mounted', async () => {
    const { mounted, prompt } = await turnFor('chat');
    expect(mounted).toContain('c4s-tools');
    expect(prompt).toMatch(/<mcp name="c4s-tools"/);
  });

  it('[ac:ac-watek-context-type-chat-z-parent-thre] a context_type=\'chat\' thread with parent_thread_id IS NULL has transagent-tools mounted (runTransagent resolvable); a child chat thread does not', async () => {
    const top = await turnFor('chat', { parentThreadId: null });
    expect(top.mounted).toContain('transagent-tools');
    // `<tooling>` is derived from the post-gate mount's own tool lists.
    // 2.1.18 — the server also carries the orchestrator's `list_patches`.
    expect(top.prompt).toMatch(/<mcp name="transagent-tools">[^<]*\brunTransagent\b[^<]*<\/mcp>/);

    // The condition is part of the criterion: the same `chat` row with a parent is stripped.
    const child = await turnFor('chat', { parentThreadId: 'parent-1' });
    expect(child.mounted).not.toContain('transagent-tools');
    expect(child.prompt).not.toMatch(/<mcp name="transagent-tools"/);
  });

  it('[ac:ac-watek-context-type-patch-ma-zamontowa-2] a context_type=\'patch\' thread has c4s-tools mounted', async () => {
    const { mounted, prompt } = await turnFor('patch', { patchPath: 'p.md' });
    expect(mounted).toContain('c4s-tools');
    expect(prompt).toMatch(/<mcp name="c4s-tools"/);
  });

  it('[ac:ac-watek-context-type-patch-nie-ma-zamon] a context_type=\'patch\' thread has no transagent-tools mounted — and keeps c4s-tools, spec-skill-tools and patch-tools', async () => {
    const { mounted, prompt } = await turnFor('patch', { patchPath: 'p.md' });
    expect(mounted).not.toContain('transagent-tools');
    expect(prompt).not.toMatch(/<mcp name="transagent-tools"/);
    // Only the orchestration server is subtracted.
    for (const kept of ['c4s-tools', 'spec-skill-tools', 'patch-tools']) {
      expect(mounted, kept).toContain(kept);
    }
  });

  it('[ac:ac-wywolanie-runtransagent-w-watku-conte] in a context_type=\'patch\' thread runTransagent is not registered with the runtime, so a call to it ends in a tool error (no handler to reach)', async () => {
    const { servers, prompt } = await turnFor('patch', { patchPath: 'p.md' });
    // The server is not registered in the runtime: `mcp__transagent-tools__runTransagent`
    // names a server absent from the map handed to `adapter.execute`, so the agent
    // runtime has nothing to dispatch the call to and answers it with its own
    // "tool not available" tool_result error (M44 `3f5ej79s`: servers outside the
    // whitelist are not registered in the runtime).
    // ASSUMPTION:dev-0001 — the error text is the agent runtime's own answer to a call
    // on an unregistered tool; the app guarantees the non-registration, not the wording.
    expect(Object.keys(servers)).not.toContain('transagent-tools');
    // No mounted server lists the tool either — `<tooling>` mirrors every mounted tool list.
    expect(prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\brunTransagent\b/);
    expect(JSON.stringify(hoisted.lastExecute?.allowedTools ?? [])).not.toContain('runTransagent');
  });

  it('[ac:ac-wywolanie-list-patches-w-watku-contex] in a context_type=\'patch\' thread list_patches is not registered with the runtime, so a call to it ends in a tool error; a top-level chat thread has it on transagent-tools', async () => {
    // The orchestrator's side: list_patches rides transagent-tools on a top-level chat thread.
    const top = await turnFor('chat', { parentThreadId: null });
    expect(top.prompt).toMatch(/<mcp name="transagent-tools">[^<]*\blist_patches\b[^<]*<\/mcp>/);

    // The patch thread: no server carrying it is handed to the runtime, and no
    // mounted server lists it — the agent runtime answers a call with its own
    // "tool not available" tool_result error (M44 `3f5ej79s`).
    // ASSUMPTION:dev-0002 — the error text is the agent runtime's answer to a call on an
    // unregistered tool; the app guarantees the non-registration, not the wording.
    const { servers, prompt } = await turnFor('patch', { patchPath: 'p.md' });
    expect(Object.keys(servers)).not.toContain('transagent-tools');
    expect(prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\blist_patches\b/);
    expect(JSON.stringify(hoisted.lastExecute?.allowedTools ?? [])).not.toContain('list_patches');
    // patch-tools itself carries only the thread's own two operations.
    expect(prompt).toContain('<mcp name="patch-tools">get_patch, mark_patch_applied</mcp>');
  });

  it('[section:iatop5pj] a top-level chat thread has list_plans on transagent-tools; a child chat thread and a patch thread do not, and plan-tools carries no list', async () => {
    // 2.1.18 (M10 `m10mcp00`, M44 `3f5ej79s`, M05 `iatop5pj`) — the orchestrator's plan picker.
    const top = await turnFor('chat', { parentThreadId: null });
    expect(top.prompt).toMatch(/<mcp name="transagent-tools">[^<]*\blist_plans\b[^<]*<\/mcp>/);
    expect(top.prompt).not.toMatch(/<mcp name="plan-tools">[^<]*\blist_plans\b/);

    const child = await turnFor('chat', { parentThreadId: 'parent-1' });
    expect(child.prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\blist_plans\b/);

    const patch = await turnFor('patch', { patchPath: 'p.md' });
    expect(patch.prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\blist_plans\b/);
  });

  it('[section:iatop5pj] a top-level chat thread has list_briefs on transagent-tools — not withheld by the profile gate; a child chat thread and a patch thread do not', async () => {
    // 2.1.18 (M21 `01ytpznn`, M44 `3f5ej79s`, M05 `iatop5pj`) — the orchestrator's brief list.
    const top = await turnFor('chat', { parentThreadId: null });
    expect(top.prompt).toMatch(/<mcp name="transagent-tools">[^<]*\blist_briefs\b[^<]*<\/mcp>/);

    const child = await turnFor('chat', { parentThreadId: 'parent-1' });
    expect(child.prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\blist_briefs\b/);

    const patch = await turnFor('patch', { patchPath: 'p.md' });
    expect(patch.prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\blist_briefs\b/);
  });

  it('[ac:ac-wywolanie-list-briefs-w-watku-context] in a context_type=\'brief\' thread list_briefs is not registered with the runtime, so a call to it ends in a tool error; brief-tools keeps its four tools', async () => {
    // The orchestrator's side: list_briefs rides transagent-tools on a top-level chat thread.
    const top = await turnFor('chat', { parentThreadId: null });
    expect(top.prompt).toMatch(/<mcp name="transagent-tools">[^<]*\blist_briefs\b[^<]*<\/mcp>/);

    // The brief thread: no transagent-tools, no mounted server lists list_briefs,
    // and it is not in the allowed tools — the agent runtime has nothing to dispatch
    // the call to and answers it with its own "tool not available" tool_result error
    // (M44 `3f5ej79s`: servers outside the whitelist are not registered in the runtime).
    // ASSUMPTION:dev-0006 — the error text is the agent runtime's answer to a call on an
    // unregistered tool; the app guarantees the non-registration, not the wording.
    const { servers, prompt } = await turnFor('brief', { briefPath: 'b.md' });
    expect(Object.keys(servers)).not.toContain('transagent-tools');
    expect(prompt).not.toMatch(/<mcp name="transagent-tools"/);
    expect(prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\blist_briefs\b/);
    expect(JSON.stringify(hoisted.lastExecute?.allowedTools ?? [])).not.toContain('list_briefs');
    // brief-tools itself stays at the four thread operations (M21 `01ytpznn`).
    const briefTools = prompt.match(/<mcp name="brief-tools">([^<]*)<\/mcp>/);
    expect(briefTools).not.toBeNull();
    expect(briefTools![1]!.split(',').map((t) => t.trim()).sort()).toEqual([
      'get_brief',
      'get_brief_version',
      'list_brief_versions',
      'update_brief',
    ]);
  });
});

/**
 * 2.1.9 (M52 `9zio901p` / `6evgp041`, M02 `cg80qj0e`) — the turn derives the
 * open file's root KIND from the service it read it from: a `skills`-kind root
 * gives `<current_skill>` (shadowed when the slug's registry winner is another
 * source) and no `<current_page>`; the hit-translation line of
 * `<available_skills>` follows `skillsRootHasFiles`.
 */
describe('runAgentTurn — open skill file and skills-root lines (M52, 2.1.9)', () => {
  async function turnWithOpenFile(opts: {
    rootKind: 'pages' | 'skills';
    path: string;
    winner?: { slug: string; source: string };
    skillsRootHasFiles?: boolean;
  }): Promise<string> {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const rootId = opts.rootKind === 'skills' ? 'skills' : 'pages';
    const service = { rootId, kind: opts.rootKind, read: async () => ({ body: 'one\ntwo' }), listTree: async () => [] };
    const d = deps as unknown as Record<string, unknown>;
    d.resolvePagesService = (id: string) => (id === rootId ? service : undefined);
    d.skillRegistry = {
      has: () => false,
      resolve: () => {
        throw new Error('unexpected resolve() call');
      },
      winnerOf: () => opts.winner,
    };
    d.skillsRootHasFiles = () => opts.skillsRootHasFiles ?? false;
    const input = makeInput();
    input.currentPage = opts.path;
    input.currentPageRootId = rootId;
    await runAgentTurn(deps, input);
    return String(hoisted.lastExecute?.systemPrompt);
  }

  it('[ac:9zio901p] an open file of the skills root yields <current_skill slug file/> and no <current_page>', async () => {
    const prompt = await turnWithOpenFile({ rootKind: 'skills', path: 'reviewer/workflows/brief.md' });
    expect(prompt).toContain('<current_skill slug="reviewer" file="workflows/brief.md"/>');
    expect(prompt).toContain('The user has this skill file open. Read it with load_skill_file(slug, file)');
    expect(prompt).not.toContain('<current_page ');
    expect(prompt).not.toContain('<current_page_handling>');
  });

  it('[ac:rkbsi6ky#13] an open file whose slug another source resolves is reported shadowed, naming the winner and its source', async () => {
    const prompt = await turnWithOpenFile({
      rootKind: 'skills',
      path: 'mockups/SKILL.md',
      winner: { slug: 'mockups', source: 'plugin' },
    });
    expect(prompt).toContain('<current_skill slug="mockups" file="SKILL.md"/>');
    expect(prompt).toContain('it is shadowed: the slug resolves to the skill "mockups" from source "plugin"');
    expect(prompt).toContain('You have no way to read this file');
  });

  it('[ac:cg80qj0e] an open page of a pages-kind root still yields <current_page>, and no <current_skill>', async () => {
    const prompt = await turnWithOpenFile({ rootKind: 'pages', path: 'guide.md' });
    expect(prompt).toContain('<current_page path="guide.md" root="pages" total_lines="2"/>');
    expect(prompt).not.toContain('<current_skill');
  });

  it('[ac:6evgp041] the hit-translation line follows whether the skills root has a file', async () => {
    const line = 'A find_references or check_consistency hit in the root "skills" at <slug>/<rest of path>';
    expect(await turnWithOpenFile({ rootKind: 'pages', path: 'guide.md', skillsRootHasFiles: true })).toContain(line);
    expect(await turnWithOpenFile({ rootKind: 'pages', path: 'guide.md', skillsRootHasFiles: false })).not.toContain(line);
  });
});

/**
 * 2.1.9 (M52 `hdkx97wq`, M44 `3f5ej79s`, M11 `6exnmup9`) — `spec-skill-tools`,
 * the write channel of the project's skill packages, is mounted in `chat` and
 * `patch` and never in `brief` or `ask`. The rig hands the turn the same
 * context-scoped element `project-context.ts` builds.
 */
describe('runAgentTurn — spec-skill-tools mounting (M52, 2.1.9)', () => {
  async function mountedWithSpecSkillTools(
    contextType: string,
    element: SpecSkillTools = new SpecSkillTools({ skillsRoot: () => undefined }, 'p1'),
    patchPath: string | null = null,
  ): Promise<string[]> {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    (deps as unknown as { specSkillTools: SpecSkillTools }).specSkillTools = element;
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = contextType;
    (input.thread as unknown as { patchPath: string | null }).patchPath = patchPath;
    await runAgentTurn(deps, input);
    return Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>).sort();
  }

  it('[ac:ac-serwer-spec-skill-tools-jest-zamontow] spec-skill-tools is mounted in chat and patch turns, with update_skill_file advertised in the tooling inventory', async () => {
    for (const [contextType, patchPath] of [['chat', null], ['patch', 'p.md']] as const) {
      const mounted = await mountedWithSpecSkillTools(contextType, undefined, patchPath);
      expect(mounted, contextType).toContain('spec-skill-tools');
      expect(String(hoisted.lastExecute?.systemPrompt), contextType).toContain(
        '<mcp name="spec-skill-tools">update_skill_file</mcp>',
      );
    }
  });

  it('[ac:ac-watek-context-type-ask-nie-ma-zamonto] a context_type=\'ask\' thread has no spec-skill-tools mounted, and update_skill_file is not advertised', async () => {
    const mounted = await mountedWithSpecSkillTools('ask');
    expect(mounted).not.toContain('spec-skill-tools');
    // The read server stays — only the write channel is subtracted.
    expect(mounted).toContain('skill-tools');
    expect(String(hoisted.lastExecute?.systemPrompt)).not.toContain('update_skill_file');
  });

  it('a brief thread has no spec-skill-tools either — the brief bubble writes a release note, not agent instructions', async () => {
    const mounted = await mountedWithSpecSkillTools('brief');
    expect(mounted).not.toContain('spec-skill-tools');
    expect(mounted).toContain('skill-tools');
  });

  it('the gate is a declared registry column, not inherited: chat and patch name it, brief and ask do not', () => {
    expect(CONTEXT_TYPE_REGISTRY.chat.mcp.specSkillTools).toBe(true);
    expect(CONTEXT_TYPE_REGISTRY.patch.mcp.specSkillTools).toBe(true);
    expect(CONTEXT_TYPE_REGISTRY.brief.mcp.specSkillTools).toBe(false);
    expect(CONTEXT_TYPE_REGISTRY.ask.mcp.specSkillTools).toBe(false);
  });

  it('M52 L10: once the context disposed its element, a turn mounts no spec-skill-tools', async () => {
    const element = new SpecSkillTools({ skillsRoot: () => undefined }, 'p1');
    element.dispose();
    expect(await mountedWithSpecSkillTools('chat', element)).not.toContain('spec-skill-tools');
  });
});

/**
 * 2.1.9 (`c4s-plugin-skill-author`, M52 `3nbgrss4`) — the `skill-author` skill
 * writes a package with `update_skill_file` and nothing else, so it works with
 * `agent.disableDirectFilesystemAccess` on. Asserted on a real chat turn under the
 * flag: the turn denies every built-in file and shell group, yet mounts
 * `spec-skill-tools`, and the very server the turn mounted writes the package the
 * skill describes into the project's `skills` root (mounted as `project-context.ts`
 * mounts it).
 */
describe('runAgentTurn — skill-author under a blocked file system (2.1.9)', () => {
  it('[ac:pkg-skill-author-writes-with-file-access-blocked] with direct file access blocked, a chat turn still mounts update_skill_file, and skill-author writes a skill package through it', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { FileWatchRuntime } = await import('../fs/watcher.js');
    const { RootRegistry } = await import('../roots/registry.js');
    const { registerCoreReactions } = await import('../workspace/core-reactions.js');
    const { mountRegistryRoots } = await import('../workspace/root-registry-runtime.js');
    const { skillAuthorSkill } = await import(
      '../../../plugins/c4s-plugin-skill-author/src/skills/skill-author.js'
    );

    // The skill names this tool as its ONLY write channel.
    expect(skillAuthorSkill.contextTypes).toContain('chat');
    expect(skillAuthorSkill.content).toContain('update_skill_file');

    registerCoreReactions();
    const userRoots = [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }];
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-author-blocked-'));
    const runtime = new FileWatchRuntime({ fsEvents: false });
    try {
      const mounted = await mountRegistryRoots({
        cwd,
        registry: new RootRegistry(userRoots),
        userRoots,
        w: runtime.scoped('context:skill-author#1'),
      });
      const skillsRoot = mounted.rootRuntimes.find((rt) => rt.root.id === 'skills');
      expect(skillsRoot, 'the skills root has a facade').toBeDefined();
      const element = new SpecSkillTools({ skillsRoot: () => ({ pages: skillsRoot!.pages }) }, 'p1');
      let built = null as ReturnType<SpecSkillTools['build']>;

      hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
      hoisted.agent = { disableDirectFilesystemAccess: true };
      const { deps } = makeDeps();
      (deps as unknown as { specSkillTools: Pick<SpecSkillTools, 'build'> }).specSkillTools = {
        build: () => (built = element.build()),
      };
      await runAgentTurn(deps, makeInput());

      // The block is on: no built-in may read or write a file, no shell.
      const groups = [...((hoisted.lastExecute?.disallowedToolGroups ?? []) as string[])];
      expect(groups).toEqual(expect.arrayContaining(['file-read', 'file-write', 'shell']));
      // …and the write channel is mounted all the same.
      expect(Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>)).toContain(
        'spec-skill-tools',
      );
      expect(built).not.toBeNull();

      // Write a package the way the skill instructs: SKILL.md with a non-empty
      // description, `expectedHash: ""` for a file that must not exist yet.
      const skillMd = [
        '---',
        'title: Release notes',
        'description: Open when writing a release note.',
        'version: 1',
        'language: en',
        'scope: contextual',
        '---',
        '',
        '# Release notes',
        '',
      ].join('\n');
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'skill-author-test', version: '0.0.0' });
      await built!.server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const res = await client.callTool({
          name: 'update_skill_file',
          arguments: { slug: 'release-notes', content: skillMd, expectedHash: '' },
        });
        expect(res.isError).toBeFalsy();
        const body = JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown>;
        expect(body).toMatchObject({ slug: 'release-notes', file: 'SKILL.md' });
        expect(fs.readFileSync(path.join(cwd, '.claude4spec/skills/release-notes/SKILL.md'), 'utf-8')).toBe(skillMd);
      } finally {
        await client.close();
      }
    } finally {
      await runtime.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * 2.1.9 (M15 `m15wsauth`, `m15edg001`) — `writing-style-author` scaffolds a style
 * through `update_skill_file` into the project's `skills` root. Asserted on real
 * turns: the turn mounts (or, in `ask`, does not mount) the write server the
 * project context hands it, and the very server the turn built writes the package
 * the skill describes. The skills root is mounted as `project-context.ts` mounts
 * it, and the project registry reads it through the `project-rooted` source.
 */
describe('runAgentTurn — writing-style-author scaffolds through update_skill_file (2.1.9)', () => {
  async function scaffoldRig() {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { FileWatchRuntime } = await import('../fs/watcher.js');
    const { RootRegistry } = await import('../roots/registry.js');
    const { registerCoreReactions } = await import('../workspace/core-reactions.js');
    const { mountRegistryRoots } = await import('../workspace/root-registry-runtime.js');
    const { SkillRegistry } = await import('../services/skill-registry.js');
    const { registerProjectRootedSkills } = await import('../services/project-rooted-skills.js');
    const { writingStyleAuthorSkill } = await import(
      '../../../plugins/c4s-plugin-writing-style-author/src/skills/writing-style-author.js'
    );
    registerCoreReactions();
    const userRoots = [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }];
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-style-author-'));
    const runtime = new FileWatchRuntime({ fsEvents: false });
    const roots = new RootRegistry(userRoots);
    const mounted = await mountRegistryRoots({ cwd, registry: roots, userRoots, w: runtime.scoped('context:style-author#1') });
    const skillsRoot = mounted.rootRuntimes.find((rt) => rt.root.id === 'skills');
    expect(skillsRoot, 'the skills root has a facade').toBeDefined();
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registerProjectRootedSkills(registry, roots, cwd);
    const element = new SpecSkillTools({ skillsRoot: () => ({ pages: skillsRoot!.pages }) }, 'p1');
    const builds: Array<ReturnType<SpecSkillTools['build']>> = [];

    /** One turn of `contextType`, handed the context's write-server element. */
    const turn = async (contextType: string) => {
      hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
      const { deps } = makeDeps();
      (deps as unknown as { specSkillTools: Pick<SpecSkillTools, 'build'> }).specSkillTools = {
        build: () => {
          const b = element.build();
          builds.push(b);
          return b;
        },
      };
      const input = makeInput();
      (input.thread as unknown as { contextType: string }).contextType = contextType;
      await runAgentTurn(deps, input);
      return {
        mounted: Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>),
        prompt: String(hoisted.lastExecute?.systemPrompt),
      };
    };

    /** Call update_skill_file on the server the last turn built. */
    const write = async (args: Record<string, unknown>) => {
      const built = builds.at(-1);
      expect(built, 'the turn built spec-skill-tools').toBeTruthy();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'style-author-test', version: '0.0.0' });
      await built!.server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const res = await client.callTool({ name: 'update_skill_file', arguments: args });
        return { isError: res.isError === true, body: JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown> };
      } finally {
        await client.close();
      }
    };

    const styleMd = (title: string) =>
      ['---', `title: ${title}`, 'description: Terse, code-first specification prose.', 'version: 1', 'language: en', 'scope: writing-style', '---', '', `# ${title}`, ''].join('\n');

    const close = async () => {
      await runtime.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    };
    return { fs, cwd, registry, builds, turn, write, styleMd, skill: writingStyleAuthorSkill, close };
  }

  it('[ac:ac-scaffold-stylu-przy-aktywnym-agent-di] with agent.disableDirectFilesystemAccess on, the scaffold still ends with a SKILL.md package in the project\'s skills root', async () => {
    const r = await scaffoldRig();
    try {
      hoisted.agent = { disableDirectFilesystemAccess: true };
      const { mounted } = await r.turn('chat');
      // The flag is on: no built-in may read or write a file, no shell…
      const groups = [...((hoisted.lastExecute?.disallowedToolGroups ?? []) as string[])];
      expect(groups).toEqual(expect.arrayContaining(['file-read', 'file-write', 'shell']));
      // …and the write channel the skill uses is mounted all the same.
      expect(mounted).toContain('spec-skill-tools');
      expect(r.skill.content).toContain('update_skill_file');

      const res = await r.write({ slug: 'terse-engineering', content: r.styleMd('Terse Engineering'), expectedHash: '' });
      expect(res.isError).toBe(false);
      expect(res.body).toMatchObject({ slug: 'terse-engineering', file: 'SKILL.md' });
      expect(r.fs.readFileSync(path.join(r.cwd, '.claude4spec/skills/terse-engineering/SKILL.md'), 'utf-8')).toBe(
        r.styleMd('Terse Engineering'),
      );
      // A package of the skills root: a selectable style of source project-rooted.
      const style = r.registry.listSelectable().find((s) => s.slug === 'terse-engineering');
      expect(style?.source).toBe('project-rooted');
    } finally {
      await r.close();
    }
  });

  it('[ac:ac-poproszenie-w-chacie-o-utworzenie-nowego] asked in chat for a new style for THIS project, the model opens writing-style-author (a chat listing row) and writes .claude4spec/skills/<slugify(title)>/SKILL.md with scope writing-style through update_skill_file', async () => {
    const r = await scaffoldRig();
    try {
      const { slugify } = await import('../../shared/slug.js');
      const matter = (await import('gray-matter')).default;
      // The skill: listed in chat only, and its instruction is this very write.
      expect(r.skill.contextTypes).toEqual(['chat']);
      // 2.1.15: this is Route A — the style for this project — and it is the one
      // that writes the package with update_skill_file.
      const routeA = /\*\*Route A — a style for this project\.\*\*([^\n]*)/.exec(r.skill.content)?.[1] ?? '';
      expect(routeA).toContain("package in this project's skills root");
      expect(routeA).toContain('`update_skill_file`');
      expect(r.skill.content).toContain('update_skill_file');
      expect(r.skill.content).toContain('.claude4spec/skills/<slug>/');
      expect(r.skill.content).toContain('scope: writing-style');
      expect(r.skill.content).toContain('slug = slugify(title)');
      expect(r.skill.content).toContain('expectedHash: ""');

      const { mounted } = await r.turn('chat');
      expect(mounted).toContain('spec-skill-tools');
      const title = 'Krótki i rzeczowy';
      const slug = slugify(title);
      expect(slug).toBe('krotki-i-rzeczowy');
      expect((await r.write({ slug, content: r.styleMd(title), expectedHash: '' })).isError).toBe(false);
      expect((await r.write({ slug, file: 'workflows/brief.md', content: '# Brief\n', expectedHash: '' })).isError).toBe(false);
      const written = r.fs.readFileSync(path.join(r.cwd, `.claude4spec/skills/${slug}/SKILL.md`), 'utf-8');
      expect(matter(written, {}).data.scope).toBe('writing-style');
      expect(r.fs.existsSync(path.join(r.cwd, `.claude4spec/skills/${slug}/workflows/brief.md`))).toBe(true);
    } finally {
      await r.close();
    }
  });

  it('[ac:ac-skill-writing-style-author-otwarty-w] writing-style-author opened in an `ask` turn writes no style — neither a package nor pages: the turn has no update_skill_file, and the skill says to write nothing on either route there', async () => {
    const r = await scaffoldRig();
    try {
      const { mounted, prompt } = await r.turn('ask');
      expect(mounted).not.toContain('spec-skill-tools');
      expect(r.builds).toHaveLength(0);
      expect(prompt).not.toContain('update_skill_file');
      // The read channel stays: the skill can be opened, it just has nothing to write with.
      expect(mounted).toContain('skill-tools');
      // The skill's own instruction for a brief/ask thread: no package AND no pages.
      const where = /\*\*Where you can write\.\*\*([^\n]*)/.exec(r.skill.content)?.[1] ?? '';
      expect(where).toContain('In a `brief` or `ask` thread');
      expect(where).toContain('`update_skill_file` (server `spec-skill-tools`) not being among your tools');
      expect(where).toContain('write no style on either route below: no package, no pages');
      expect(where).toContain('no `create_page`, no `update_sections`');
      expect(where).toContain('writing a style needs a `chat` or `patch` thread, and stop');
      expect(r.fs.existsSync(path.join(r.cwd, '.claude4spec/skills'))
        ? r.fs.readdirSync(path.join(r.cwd, '.claude4spec/skills')).filter((n) => !n.startsWith('.'))
        : []).toEqual([]);
      expect(r.registry.listSelectable()).toEqual([]);
    } finally {
      await r.close();
    }
  });
});

/**
 * 2.1.9 (M15 `9fq44253`, edge case "Zmiana config.writingStyle przy uruchomionym
 * serwerze") — the style is settled on a thread's first turn: a resumed thread
 * keeps the writing style it started with, a new one takes the current config.
 */
describe('runAgentTurn — a thread keeps the writing style of its first turn (M15, 2.1.9)', () => {
  it('[ac:ac-edycja-config-json-null-slug-mie] after config.writingStyle changes from null to a slug, the next turn of an existing thread still carries no <project_writing_skill/> block', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const { writeConfig } = await import('../config.js');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-style-frozen-'));
    try {
      // The config NOW says house-style…
      writeConfig(cwd, { writingStyle: 'house-style' });
      const resolveForContext = vi.fn((_ct: string, cfg: { writingStyle: string | null }) => ({
        listing: [],
        writingStyle: cfg.writingStyle ? { slug: cfg.writingStyle, title: 'House Style' } : null,
      }));
      // …but the thread's first turn ran under writingStyle: null.
      hoisted.events = [{ type: 'result', sessionId: 's-prev' }];
      const { deps, storedSnapshot } = makeDeps();
      (deps as unknown as { cwd: string }).cwd = cwd;
      (deps as unknown as { skillResolver: unknown }).skillResolver = { resolveForContext };
      storedSnapshot.json = JSON.stringify({
        model: 'claude-opus-5',
        architectureConfig: {},
        allowedPaths: [],
        disallowedPaths: [],
        pageRootDirs: [path.join(cwd, 'pages')],
        lockedConfig: { 'agent.allowedPaths': [] },
        promptConfig: { name: 'Then', language: null, conversationalLanguage: null, writingStyle: null },
      });
      const input = makeInput();
      (input.thread as unknown as { lastSessionId: string }).lastSessionId = 's-prev';
      await runAgentTurn(deps, input);
      expect(resolveForContext).toHaveBeenLastCalledWith('chat', { writingStyle: null });
      expect(String(hoisted.lastExecute?.systemPrompt)).not.toContain('<project_writing_skill');

      // Contrast: a NEW thread under the same config gets the style.
      hoisted.events = [{ type: 'result', sessionId: 's-new' }];
      const fresh = makeDeps();
      (fresh.deps as unknown as { cwd: string }).cwd = cwd;
      (fresh.deps as unknown as { skillResolver: unknown }).skillResolver = { resolveForContext };
      await runAgentTurn(fresh.deps, makeInput());
      expect(resolveForContext).toHaveBeenLastCalledWith('chat', { writingStyle: 'house-style' });
      expect(String(hoisted.lastExecute?.systemPrompt)).toContain('<project_writing_skill slug="house-style"');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * M26 `#project` card → `PATCH /api/config { writingStyle }` (effect `new-thread`):
 * the settings save is read by the next NEW thread's first turn straight from
 * config.json — no server restart, no context rebuild in between.
 */
describe('runAgentTurn — a writingStyle saved on the settings page reaches the next new thread (M26)', () => {
  it('[ac:ac-zmiana-writingstyle-w-m26-sekcja-proje] after PATCH /api/config { writingStyle } the first turn of a new thread uses the new style, without a server restart', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const { default: express } = await import('express');
    const { default: request } = await import('supertest');
    const { writeConfig } = await import('../config.js');
    const { configRouter } = await import('./config.js');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-style-patch-'));
    try {
      writeConfig(cwd, { writingStyle: 'old-style' });
      const titles: Record<string, string> = { 'old-style': 'Old Style', 'new-style': 'New Style' };
      const skillRegistry = {
        isSelectable: (slug: string) => slug in titles,
        unselectableReason: () => 'is not installed',
        listSelectable: () => [],
      };
      const resolveForContext = vi.fn((_ct: string, cfg: { writingStyle: string | null }) => ({
        listing: [],
        writingStyle: cfg.writingStyle ? { slug: cfg.writingStyle, title: titles[cfg.writingStyle]! } : null,
      }));
      const onContextConfigChanged = vi.fn();
      // ONE server process for the whole test: the router and the turn deps are built once.
      const server = express()
        .use(express.json())
        .use(configRouter({ cwd, skillRegistry: skillRegistry as never, onContextConfigChanged }));
      const turnDeps = () => {
        const { deps } = makeDeps();
        (deps as unknown as { cwd: string }).cwd = cwd;
        (deps as unknown as { skillResolver: unknown }).skillResolver = { resolveForContext };
        return deps;
      };

      // Before the change: a new thread runs under old-style.
      hoisted.events = [{ type: 'result', sessionId: 's-1' }];
      await runAgentTurn(turnDeps(), makeInput());
      expect(String(hoisted.lastExecute?.systemPrompt)).toContain('<project_writing_skill slug="old-style"');

      // The settings page's Project card saves the new style.
      const res = await request(server).patch('/config').send({ writingStyle: 'new-style' });
      expect(res.status).toBe(200);
      expect(res.body.writingStyle).toBe('new-style');
      // `new-thread` effect: nothing is rebuilt or restarted.
      expect(onContextConfigChanged).not.toHaveBeenCalled();

      // The first turn of a NEW thread, same process: the new style.
      hoisted.events = [{ type: 'result', sessionId: 's-2' }];
      await runAgentTurn(turnDeps(), makeInput());
      expect(resolveForContext).toHaveBeenLastCalledWith('chat', { writingStyle: 'new-style' });
      const prompt = String(hoisted.lastExecute?.systemPrompt);
      expect(prompt).toContain('<project_writing_skill slug="new-style"');
      expect(prompt).not.toContain('slug="old-style"');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * TERMINAL ERROR DELIVERY (0.2.50).
 *
 * The contract is explicit that "the iterator never throws (M01/M13)" — every
 * adapter error, `AdapterTimeoutError` and `AdapterAbortError` included, arrives
 * as `{ type: 'error' }` and the generator then ends normally. An earlier draft
 * of the turn loop captured only the tool-policy and hold-cap classes and
 * assumed the other two were thrown, so a timed-out turn RESOLVED AS SUCCESS
 * with an empty answer while the client got an unshaped error frame with no
 * `code` on it. These cases pin every class to a code.
 */
describe('runAgentTurn — delivered terminal errors', () => {
  const cases: Array<{ name: string; error: Error; code: string }> = [
    {
      name: 'AdapterTimeoutError',
      error: new AdapterTimeoutError('claude-code', 1000),
      code: 'TIMEOUT',
    },
    { name: 'AdapterAbortError', error: new AdapterAbortError('claude-code'), code: 'ABORTED' },
    {
      name: 'AdapterIdleTimeoutError',
      error: new AdapterIdleTimeoutError('claude-code', IDLE_TIMEOUT_MS),
      code: 'IDLE_TIMEOUT',
    },
    {
      name: 'AdapterBackgroundHoldExpiredError',
      error: new AdapterBackgroundHoldExpiredError('claude-code', 1000),
      code: 'BACKGROUND_HOLD_EXPIRED',
    },
  ];

  for (const { name, error, code } of cases) {
    it(`fails the turn with ${code} when the stream delivers ${name}`, async () => {
      hoisted.events = [
        { type: 'text_delta', text: 'partial' },
        { type: 'error', error, phase: 'runtime' },
      ];
      const { deps } = makeDeps();
      const seen: Array<Record<string, unknown>> = [];

      // MUST reject. Resolving here is the actual bug this pins: the generator
      // ends normally after delivering the error, so nothing else stops the turn.
      await expect(
        runAgentTurn(deps, { ...makeInput(), onEvent: (e) => seen.push(e as never) }),
      ).rejects.toMatchObject({ name: 'AgentTurnError', code });

      // Exactly ONE error frame, and it is the typed one — the raw adapter event
      // (a live `Error` under `error`, no `code`) must never reach the wire.
      const errors = seen.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe(code);
      expect(typeof errors[0]!.error).toBe('string');
    });
  }

  /**
   * The refusal path used to `emit` and then `throw`, and the catch emitted the
   * same frame again — two identical errors on the wire and two in the replay
   * buffer, since `error` is a replayed type.
   */
  it('emits exactly one error frame when plan mode is refused pre-dispatch', async () => {
    const probe = await import('@inharness-ai/agent-adapters');
    const spy = vi
      .spyOn(probe, 'probeToolGating')
      .mockReturnValue([
        { group: 'shell', enforceable: false } as never,
        { group: 'file-write', enforceable: true, strength: 'soft' } as never,
      ]);
    try {
      hoisted.events = [{ type: 'result', sessionId: 's1' }];
      const { deps } = makeDeps();
      const seen: Array<Record<string, unknown>> = [];
      const input = { ...makeInput(), onEvent: (e: unknown) => seen.push(e as never) };
      (input.thread as { planMode: boolean }).planMode = true;

      await expect(runAgentTurn(deps, input)).rejects.toMatchObject({
        code: 'TOOL_POLICY_REFUSED',
      });

      expect(seen.filter((e) => e.type === 'error')).toHaveLength(1);
      // 2.1.51: exactly `error` + `done` — `done` ends the stream on the error
      // path too, with no `adapter_ready` and no `result`.
      expect(seen.map((e) => e.type).filter((t) => t !== 'connected')).toEqual(['error', 'done']);
      // Refused BEFORE dispatch: the adapter was never asked to run.
      expect(hoisted.executes).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * 2.1.56 (M05 `yazwev1g`) — the plan-mode preset's enforceability is asked of
 * the library SYNCHRONOUSLY, before dispatch: the probe answers with a value,
 * not a promise, and it runs before `adapter.execute`, so an unenforceable
 * preset is a refusal to start rather than a degradation learned from an event.
 */
describe('runAgentTurn — plan-mode enforceability probe before dispatch', () => {
  it('[ac:ac-toggle-plan-mode-jest-pokazywany-jako] probes the preset groups synchronously before execute, and refuses before the adapter starts', async () => {
    const probe = await import('@inharness-ai/agent-adapters');
    // Synchronous: the library answers with the reports themselves.
    const direct = probe.probeToolGating('claude-code', [...probe.PLAN_MODE_DENY_GROUPS]);
    expect(Array.isArray(direct)).toBe(true);
    expect(typeof (direct as unknown as { then?: unknown }).then).toBe('undefined');

    const order: string[] = [];
    const probedGroups: string[][] = [];
    let enforceable = true;
    const realProbe = probe.probeToolGating;
    const spy = vi.spyOn(probe, 'probeToolGating').mockImplementation((arch, groups) => {
      order.push('probe');
      probedGroups.push([...groups]);
      const reports = realProbe(arch, groups);
      return enforceable ? reports : reports.map((r) => ({ ...r, enforceable: false }) as unknown as typeof r);
    });
    hoisted.onExecute = () => order.push('execute');
    try {
      hoisted.events = [{ type: 'result', sessionId: 's1' }];
      const enforced = makeDeps();
      const okInput = makeInput();
      (okInput.thread as { planMode: boolean }).planMode = true;
      await runAgentTurn(enforced.deps, okInput);
      // Asked with the preset's groups, and before the adapter ran.
      expect(probedGroups.some((g) => probe.PLAN_MODE_DENY_GROUPS.every((p) => g.includes(p)))).toBe(true);
      expect(order.indexOf('probe')).toBeGreaterThan(-1);
      expect(order.indexOf('probe')).toBeLessThan(order.indexOf('execute'));

      // Unenforceable → the caller refuses before the adapter is ever started.
      order.length = 0;
      hoisted.executes = [];
      enforceable = false;
      const refused = makeDeps();
      const refusedInput = makeInput();
      (refusedInput.thread as { planMode: boolean }).planMode = true;
      await expect(runAgentTurn(refused.deps, refusedInput)).rejects.toMatchObject({ code: 'TOOL_POLICY_REFUSED' });
      expect(order).toContain('probe');
      expect(order).not.toContain('execute');
      expect(hoisted.executes).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * M05 — the agent runs the local `claude` CLI; when it is missing or not logged
 * in the adapter reports `AdapterInitError`, and the turn ends
 * `AGENT_UNAVAILABLE`, which the turn routes answer as `503` (the route
 * deviation in M05 API (L4): an environment state, not a bad request).
 */
describe('runAgentTurn — claude CLI unavailable', () => {
  it('[ac:ac-claude-cli-niezainstalowane-lub-nieza] AdapterInitError ends the turn AGENT_UNAVAILABLE, answered 503', async () => {
    const { STATUS_FOR_TURN_ERROR } = await import('../operations/error-codes.js');
    hoisted.events = [{ type: 'error', error: new AdapterInitError('claude-code', new Error('spawn claude ENOENT')), phase: 'init' }];
    const { deps } = makeDeps();
    const seen: Array<Record<string, unknown>> = [];

    const failure = await runAgentTurn(deps, { ...makeInput(), onEvent: (e) => seen.push(e as never) }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(AgentTurnError);
    expect((failure as AgentTurnError).code).toBe('AGENT_UNAVAILABLE');
    expect((failure as AgentTurnError).message).toContain('claude login');
    const errors = seen.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('AGENT_UNAVAILABLE');
    // The status every turn route answers this code with.
    expect(STATUS_FOR_TURN_ERROR.AGENT_UNAVAILABLE).toBe(503);
  });
});

/**
 * 0.2.107: silence is detected by the LIBRARY's idle clock (`idleTimeoutMs`,
 * agent-adapters >= 0.9.11). What stays ours: passing the budget, mapping
 * `AdapterIdleTimeoutError` to `IDLE_TIMEOUT`, and the Stop-like side effects
 * of an idle end — the queue cleared and broadcast, the children stopped.
 */
describe('runAgentTurn — library idle clock (0.2.107)', () => {
  function withQueue(deps: AgentTurnDeps, queued: string[]) {
    (deps.chatService as unknown as { clearQueued: () => string[] }).clearQueued = () => queued.splice(0);
  }

  it('[ac:ac-tura-w-ktorej-adapter-milczy-dluzej-n] hands the adapter the interactive idle budget next to the backstop', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect(hoisted.lastExecute?.idleTimeoutMs).toBe(IDLE_TIMEOUT_MS);
    expect(hoisted.lastExecute?.idleTimeoutMs).toBe(3_600_000);
    expect(hoisted.lastExecute?.timeoutMs).toBe(TURN_TIMEOUT_MS);
  });

  it('gives a turn with its own `timeoutMs` (`ask`) no idle clock', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, { ...makeInput(), timeoutMs: 15 * 60_000 });

    expect(hoisted.lastExecute?.timeoutMs).toBe(15 * 60_000);
    expect(hoisted.lastExecute).not.toHaveProperty('idleTimeoutMs');
  });

  for (const how of ['delivered', 'thrown'] as const) {
    it(`[ac:ac-tura-w-ktorej-adapter-milczy-dluzej-n] ends an idle turn with IDLE_TIMEOUT, clears the queue and stops the children (${how})`, async () => {
      const idle = new AdapterIdleTimeoutError('claude-code', IDLE_TIMEOUT_MS);
      hoisted.events = [{ type: 'text_delta', text: 'thinking about it…' }];
      if (how === 'delivered') hoisted.events.push({ type: 'error', error: idle, phase: 'runtime' });
      else hoisted.beforeEvent = () => {
        throw idle;
      };
      const { deps } = makeDeps();
      withQueue(deps, ['queued while idle']);
      const childAbort = vi.fn();
      deps.activeAdapters.set('child', {
        requestId: 'r-child',
        adapter: { abort: childAbort },
        parentThreadId: 't1',
      } as never);
      const events: Array<Record<string, unknown>> = [];
      const input = { ...makeInput(), onEvent: (e: Record<string, unknown>) => events.push(e) };

      const err = await runAgentTurn(deps, input).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AgentTurnError);
      expect((err as AgentTurnError).code).toBe('IDLE_TIMEOUT');
      const terminal = events.filter((e) => e.type === 'error');
      expect(terminal).toHaveLength(1);
      expect(terminal[0]?.code).toBe('IDLE_TIMEOUT');
      // No HTTP abort behind it: the turn clears the queue and broadcasts it itself.
      expect(events).toContainEqual({ type: 'queue_cleared', texts: ['queued while idle'] });
      expect(childAbort).toHaveBeenCalledTimes(1);
    });
  }

  it('[ac:ac-tura-w-ktorej-adapter-milczy-dluzej-n] keeps AdapterAbortError a user Stop — ABORTED, queue untouched', async () => {
    hoisted.events = [{ type: 'error', error: new AdapterAbortError('claude-code'), phase: 'runtime' }];
    const { deps } = makeDeps();
    const clearQueued = vi.fn(() => []);
    (deps.chatService as unknown as { clearQueued: () => string[] }).clearQueued = clearQueued;
    const events: Array<Record<string, unknown>> = [];
    const input = { ...makeInput(), onEvent: (e: Record<string, unknown>) => events.push(e) };

    const err = await runAgentTurn(deps, input).catch((e: unknown) => e);

    expect((err as AgentTurnError).code).toBe('ABORTED');
    expect(events.find((e) => e.type === 'error')?.code).toBe('ABORTED');
    // The Stop route clears the queue itself; the turn must not do it twice.
    expect(clearQueued).not.toHaveBeenCalled();
  });
});

describe('runAgentTurn — timeouts and cascades (0.2.107 review)', () => {
  for (const how of ['delivered', 'thrown'] as const) {
    it(`a TIMEOUT stops the children too, and names the caller's cap for \`ask\` (${how})`, async () => {
      const timeout = new AdapterTimeoutError('claude-code', 15 * 60_000);
      hoisted.events = [{ type: 'text_delta', text: 'still going…' }];
      if (how === 'delivered') hoisted.events.push({ type: 'error', error: timeout, phase: 'runtime' });
      else hoisted.beforeEvent = () => {
        throw timeout;
      };
      const { deps } = makeDeps();
      const child = { requestId: 'r-child', adapter: { abort: vi.fn() }, parentThreadId: 't1' } as Record<string, unknown>;
      deps.activeAdapters.set('child', child as never);

      const err = await runAgentTurn(deps, { ...makeInput(), timeoutMs: 15 * 60_000 }).catch((e: unknown) => e);

      expect((err as AgentTurnError).code).toBe('TIMEOUT');
      expect((err as AgentTurnError).message).toBe('Agent took too long to respond (15 min cap)');
      expect((child.adapter as { abort: ReturnType<typeof vi.fn> }).abort).toHaveBeenCalledTimes(1);
      expect(child.cascadeReason).toBe('parent-timeout');
    });
  }

  it('an idle end tags the children, grandchildren included, with the reason', async () => {
    hoisted.events = [
      { type: 'error', error: new AdapterIdleTimeoutError('claude-code', IDLE_TIMEOUT_MS), phase: 'runtime' },
    ];
    const { deps } = makeDeps();
    const child = { requestId: 'r-c', adapter: { abort: vi.fn() }, parentThreadId: 't1' } as Record<string, unknown>;
    const grandchild = { requestId: 'r-g', adapter: { abort: vi.fn() }, parentThreadId: 'child' } as Record<string, unknown>;
    deps.activeAdapters.set('child', child as never);
    deps.activeAdapters.set('grandchild', grandchild as never);

    await runAgentTurn(deps, makeInput()).catch(() => undefined);

    expect(child.cascadeReason).toBe('parent-idle');
    expect(grandchild.cascadeReason).toBe('parent-idle');
  });

  for (const [reason, code] of [
    ['parent-idle', 'IDLE_TIMEOUT'],
    ['parent-timeout', 'TIMEOUT'],
    [undefined, 'ABORTED'],
  ] as const) {
    it(`a child aborted by a cascade reports ${code}, not a Stop nobody pressed (${reason ?? 'human Stop'})`, async () => {
      const { deps } = makeDeps();
      hoisted.events = [{ type: 'text_delta', text: 'working…' }];
      hoisted.beforeEvent = () => {
        const entry = deps.activeAdapters.get('t1');
        if (entry && reason) entry.cascadeReason = reason;
        throw new AdapterAbortError('claude-code');
      };
      const events: Array<Record<string, unknown>> = [];

      const err = await runAgentTurn(deps, { ...makeInput(), onEvent: (e) => events.push(e as never) }).catch(
        (e: unknown) => e,
      );

      expect((err as AgentTurnError).code).toBe(code);
      expect(events.find((e) => e.type === 'error')?.code).toBe(code);
    });
  }
});

/**
 * agent-adapters 0.9.12: a subagent re-entered via SendMessage starts again
 * under the SAME task id (`resumed: true`); the last completion ends it.
 */
describe('runAgentTurn — subagent re-entry (agent-adapters 0.9.12)', () => {
  it('persists every cycle of a re-entered subagent and forwards the resumed start', async () => {
    hoisted.events = [
      { type: 'subagent_started', taskId: 'task1', description: 'explore', toolUseId: 'tu_task' },
      { type: 'subagent_completed', taskId: 'task1', status: 'completed', summary: 'first' },
      {
        type: 'subagent_started',
        taskId: 'task1',
        description: 'follow-up',
        toolUseId: 'tu_send',
        resumed: true,
      },
      { type: 'subagent_completed', taskId: 'task1', status: 'completed', summary: 'second' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const starts: unknown[][] = [];
    const completions: unknown[][] = [];
    Object.assign(deps.chatService, {
      startSubagentTask: (...args: unknown[]) => starts.push(args),
      completeSubagentTask: (...args: unknown[]) => completions.push(args),
    });
    const events: Array<Record<string, unknown>> = [];

    await runAgentTurn(deps, { ...makeInput(), onEvent: (e) => events.push(e as never) });

    expect(starts).toEqual([
      ['t1', 'task1', 'explore', 'tu_task'],
      ['t1', 'task1', 'follow-up', 'tu_send'],
    ]);
    expect(completions.at(-1)).toEqual(['t1', 'task1', 'completed', 'second']);
    const started = events.filter((e) => e.type === 'subagent_started');
    expect(started).toHaveLength(2);
    expect(started[1]).toMatchObject({ taskId: 'task1', resumed: true });
  });
});

/**
 * 0.2.111 (M46): a banka continuation founds a NEW row whose first turn resumes the
 * referenced banka's session. What the turn runner owes that row: no system-prompt
 * snapshot (the CLI ignores a system prompt on resume, so the column would claim
 * something the agent never saw), a registry entry naming the session it resumes
 * (the dispatcher refuses a second resume of it with STREAM_IN_PROGRESS), and the
 * caller as the cascade parent.
 */
describe('runAgentTurn — resuming turns (0.2.111)', () => {
  it('[ac:ac-po-turze-kontynuacji-initial-system-p] does not write initial_system_prompt on a turn that resumes a session', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'resumed' },
      { type: 'result', sessionId: 's-prev' },
    ];
    const { deps } = makeDeps();
    const cs = deps.chatService as unknown as { setInitialSystemPrompt: (...a: unknown[]) => void };
    const write = vi.spyOn(cs, 'setInitialSystemPrompt');
    const input = makeInput();
    (input.thread as unknown as { lastSessionId: string }).lastSessionId = 's-prev';

    await runAgentTurn(deps, input);

    expect(write).not.toHaveBeenCalled();
    expect(hoisted.lastExecute?.resumeSessionId).toBe('s-prev');
  });

  it('[ac:ac-wyrenderowany-system-prompt-pierwszej] still writes it on a turn that opens a session', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'fresh' },
      { type: 'result', sessionId: 's-new' },
    ];
    const { deps } = makeDeps();
    const cs = deps.chatService as unknown as { setInitialSystemPrompt: (...a: unknown[]) => void };
    const write = vi.spyOn(cs, 'setInitialSystemPrompt');

    await runAgentTurn(deps, makeInput());

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe('t1');
  });

  it('registers the session a turn runs in the live-adapter registry, refreshed when the adapter reports it', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'x' },
      { type: 'result', sessionId: 's-reported' },
      // Anything after the `result` observes the refreshed entry.
      { type: 'text_delta', text: 'y' },
    ];
    const { deps } = makeDeps();
    const seen: Array<string | null | undefined> = [];
    const input = makeInput();
    (input.thread as unknown as { lastSessionId: string }).lastSessionId = 's-prev';
    input.onEvent = (e) => {
      const entry = deps.activeAdapters.get('t1');
      if (entry && (e as { type: string }).type !== 'done') seen.push(entry.sessionId);
    };

    await runAgentTurn(deps, input);

    expect(seen[0]).toBe('s-prev');
    expect(seen.at(-1)).toBe('s-reported');
  });
});

describe('abortChildTurns — continuation rows (0.2.111)', () => {
  it("cascades to the caller's continuation row but not to earlier rows of the same session", () => {
    const aborted: string[] = [];
    const entry = (id: string, parentThreadId: string): ActiveAdapter =>
      ({
        requestId: `r-${id}`,
        parentThreadId,
        sessionId: 'sess-shared',
        adapter: { abort: () => aborted.push(id) },
      }) as unknown as ActiveAdapter;
    const activeAdapters = new Map<string, ActiveAdapter>([
      ['earlier-row', entry('earlier-row', 'other-top-level')],
      ['continuation-row', entry('continuation-row', 'caller')],
    ]);

    abortChildTurns(activeAdapters, new Map(), 'caller');

    expect(aborted).toEqual(['continuation-row']);
  });
});

/**
 * 0.2.113: the resume-config snapshot's config half. The scope and the `new-thread`
 * prompt inputs are settled by the turn that opens a session; a resumed turn reuses
 * them, whatever config says by then.
 */
describe('runAgentTurn — session config is settled on the first turn (0.2.113)', () => {
  it('records the declared locked fields, the prompt inputs and the page-root block on turn 1', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's-new' }];
    hoisted.agent = { allowedPaths: ['/extra'] };
    const { deps, snapshots } = makeDeps();
    await runAgentTurn(deps, makeInput());
    const snap = snapshots.at(-1)!;
    expect(snap.lockedConfig).toMatchObject({
      'agent.allowedPaths': ['/extra'],
      'agent.disallowedPaths': [],
    });
    // 2.1.8: the artifact dirs are fixed system roots — no `*Dir` config key is locked any more.
    for (const k of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir']) {
      expect(snap.lockedConfig).not.toHaveProperty(k);
    }
    expect(snap.promptConfig).toHaveProperty('writingStyle');
    expect(snap.pageRootDirs).toEqual(PAGE_ROOTS_ABS);
  });

  it('a resumed turn runs on the session scope, not on the current config', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's-prev' }];
    // Config moved on since the session opened — a new thread would get this.
    hoisted.agent = { allowedPaths: ['/moved-on'] };
    const { deps, storedSnapshot } = makeDeps();
    storedSnapshot.json = JSON.stringify({
      model: 'claude-opus-5',
      architectureConfig: {},
      allowedPaths: ['/frozen'],
      disallowedPaths: ['/deny'],
      pageRootDirs: ['/pages-then'],
      lockedConfig: { 'agent.allowedPaths': ['/frozen'] },
      promptConfig: { name: 'Then', language: null, conversationalLanguage: null, writingStyle: 'style-then' },
    });
    const input = makeInput();
    (input.thread as unknown as { lastSessionId: string }).lastSessionId = 's-prev';
    const resolveForContext = vi.fn(() => ({ listing: [], writingStyle: null }));
    (deps as unknown as { skillResolver: unknown }).skillResolver = { resolveForContext };

    await runAgentTurn(deps, input);

    expect(hoisted.lastExecute?.allowedPaths).toEqual(['/frozen']);
    expect(hoisted.lastExecute?.disallowedPaths).toEqual(['/deny']);
    const sandbox = (hoisted.lastExecute?.architectureConfig as { claude_sandbox: { filesystem: Record<string, string[]> } })
      .claude_sandbox.filesystem;
    expect(sandbox.denyWrite).toEqual(['/deny', '/pages-then']);
    // The writing style the thread started with, not the one config holds now.
    expect(resolveForContext).toHaveBeenCalledWith('chat', { writingStyle: 'style-then' });
  });

  it('a snapshot from before 0.2.113 (no lockedConfig) keeps the per-turn scope', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's-prev' }];
    hoisted.agent = { allowedPaths: ['/current'] };
    const { deps, storedSnapshot } = makeDeps();
    storedSnapshot.json = JSON.stringify({ model: 'm', architectureConfig: {}, allowedPaths: ['/old'], disallowedPaths: [] });
    const input = makeInput();
    (input.thread as unknown as { lastSessionId: string }).lastSessionId = 's-prev';
    await runAgentTurn(deps, input);
    expect(hoisted.lastExecute?.allowedPaths).toContain('/current');
  });
});

/**
 * 0.2.114: `turn_start.turnStartedAt` — start of the turn or of the last merged
 * dispatch. One marker scopes both the replay buffer and the client's turn
 * clock: a merged dispatch resets both, a continuation (background task or
 * delegation) and a mid-turn push reset neither.
 */
describe('runAgentTurn — 0.2.114 turnStartedAt on turn_start', () => {
  type ReplayView = { replay: { events: Array<Record<string, unknown>>; turnStart: Record<string, unknown> } };
  const activeOf = (deps: AgentTurnDeps) => (deps.activeAdapters as Map<string, ReplayView>).get('t1')!;

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drains exactly one queued batch, so the turn runs a merged dispatch. */
  function queueOneFollowUp(deps: AgentTurnDeps): void {
    let drained = false;
    (deps.chatService as unknown as { popAllQueued: () => Array<{ prompt: string }> }).popAllQueued = () => {
      if (drained) return [];
      drained = true;
      return [{ prompt: 'queued follow-up' }];
    };
  }

  it('the turn start carries turnStartedAt equal to its timestamp, held on replay.turnStart', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'hi' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    let turnStart: Record<string, unknown> | null = null;
    hoisted.beforeEvent = () => {
      turnStart ??= { ...activeOf(deps).replay.turnStart };
    };
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    expect(typeof turnStart!.turnStartedAt).toBe('string');
    expect(new Date(turnStart!.turnStartedAt as string).toISOString()).toBe(turnStart!.turnStartedAt);
    expect(turnStart!.turnStartedAt).toBe(turnStart!.timestamp);
    // Not sent live to the POST sender — joiners get it through the replay only.
    expect(emitted.some((e) => e.type === 'turn_start')).toBe(false);
  });

  it.each([
    [
      'a background task',
      [
        { type: 'text_delta', text: 'Backgrounding. ' },
        { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'sleep 5' },
        { type: 'result', sessionId: 's-held', backgroundTasks: [{ taskId: 'bg1', taskType: 'shell' }] },
        { type: 'background_task_completed', taskId: 'bg1', taskType: 'shell', status: 'success' },
        { type: 'text_delta', text: 'Continuation.' },
        { type: 'result', sessionId: 's-final' },
      ],
    ],
    [
      'a delegation',
      [
        { type: 'text_delta', text: 'Delegating. ' },
        { type: 'subagent_started', taskId: 'sub_1', description: 'Explore', toolUseId: 'tool_q' },
        { type: 'result', sessionId: 's-parked' },
        { type: 'subagent_completed', taskId: 'sub_1', status: 'completed' },
        { type: 'text_delta', text: 'Continuation.' },
        { type: 'result', sessionId: 's-final' },
      ],
    ],
  ])('[ac:ac-kontynuacja-po-zadaniu-w-tle-lub-dele] [ac:ac-turn-start-kontynuacji-niesie-turnsta] a continuation after %s inherits turnStartedAt and resets nothing', async (_label, events) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:12:03.000Z'));
    hoisted.events = events;
    const { deps } = makeDeps();
    let before: Record<string, unknown> | null = null;
    let replayAtEnd: Array<Record<string, unknown>> = [];
    let turnStartAtEnd: Record<string, unknown> | null = null;
    hoisted.beforeEvent = (event) => {
      before ??= { ...activeOf(deps).replay.turnStart };
      if (event.type === 'result') vi.setSystemTime(new Date('2026-09-25T10:14:52.000Z'));
      if (event.type === 'result' && event.sessionId === 's-final') {
        replayAtEnd = [...activeOf(deps).replay.events];
        turnStartAtEnd = { ...activeOf(deps).replay.turnStart };
      }
    };
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    const cont = emitted.find((e) => e.type === 'turn_start')!;
    expect(cont.userMessageId).toBe(before!.userMessageId);
    expect(cont.assistantMessageId).toBe(before!.assistantMessageId);
    expect(cont.turnStartedAt).toBe('2026-09-25T10:12:03.000Z');
    expect(cont.timestamp).toBe('2026-09-25T10:14:52.000Z');
    // replay.turnStart untouched; the buffer holds BOTH segments, the
    // continuation's turn_start appended after the parked result.
    expect(turnStartAtEnd).toEqual(before);
    const types = replayAtEnd.map((e) => e.type);
    expect(types.indexOf('turn_start')).toBeGreaterThan(types.indexOf('result'));
    expect(replayAtEnd.find((e) => e.type === 'text_delta')?.text).toMatch(/^(Backgrounding|Delegating)/);
    expect(replayAtEnd.filter((e) => e.type === 'text_delta').at(-1)?.text).toBe('Continuation.');
  });

  it('[ac:ac-wiadomosc-wepchnieta-w-trakcie-pracy] a mid-turn push mints no turn_start and leaves replay.turnStart as is', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'Working. ' },
      { type: 'user_message', text: 'pushed mid-turn', timestamp: Date.now() },
      { type: 'text_delta', text: 'Still working.' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const seen: Array<Record<string, unknown>> = [];
    hoisted.beforeEvent = () => {
      seen.push(activeOf(deps).replay.turnStart);
    };
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    expect(emitted.filter((e) => e.type === 'turn_start')).toHaveLength(0);
    expect(new Set(seen).size).toBe(1);
  });

  it('[ac:ac-merged-dispatch-zeruje-zegar-tury] [ac:ac-turn-start-po-merged-dispatch-niesie] a merged dispatch mints new ids and a new turnStartedAt, and resets the replay buffer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
    hoisted.events = [{ type: 'text_delta', text: 'first' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    queueOneFollowUp(deps);
    let first: Record<string, unknown> | null = null;
    let second: Record<string, unknown> | null = null;
    let eventsAtSecond: Array<Record<string, unknown>> = [];
    hoisted.beforeEvent = (event) => {
      const active = activeOf(deps);
      if (hoisted.executes.length === 1) {
        first ??= active.replay.turnStart;
        if (event.type === 'result') vi.setSystemTime(new Date('2026-09-25T10:05:00.000Z'));
      } else if (!second) {
        second = active.replay.turnStart;
        eventsAtSecond = [...active.replay.events];
      }
    };
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    expect(first!.turnStartedAt).toBe('2026-09-25T10:00:00.000Z');
    expect(second!.turnStartedAt).toBe('2026-09-25T10:05:00.000Z');
    expect(second!.timestamp).toBe(second!.turnStartedAt);
    expect(second!.assistantMessageId).not.toBe(first!.assistantMessageId);
    expect(second!.userMessageId).not.toBe(first!.userMessageId);
    // Sent live, and the buffer restarted with it.
    expect(emitted.find((e) => e.type === 'turn_start')).toEqual(second);
    expect(eventsAtSecond).toEqual([]);
  });
});

/**
 * 2.1.13 (M05 turn runtime `zbqomxbo`, M10 `bu7efowe` / `i1nvq4ju`, M48 `da1d88do`)
 * — the plan reaches the turn's prompt only as M10's `<current_plan>` (address and
 * version, never the body), the turn runtime has no plan block of its own any more,
 * and the `<tooling>` line of the plan server is derived from the REAL plan-tools
 * registration: six tools, `create_plan` among them.
 */
describe('runAgentTurn — plan in the prompt (2.1.13)', () => {
  const PINNED = {
    path: 'migracja-kontraktow-wire.md',
    frontmatter: { title: 'Migracja kontraktów wire', applied: false },
    body: '# Migracja\n\nUNIQUE-PLAN-BODY-LINE\n',
    content: '---\ntitle: Migracja kontraktów wire\n---\n# Migracja\n\nUNIQUE-PLAN-BODY-LINE\n',
    hash: 'plan-hash-85fa8219',
    currentVersion: 4,
    createdAt: '2026-08-14T09:12:00Z',
    updatedAt: '2026-08-19T12:35:00Z',
  };

  async function promptFor(opts: {
    plan?: unknown;
    contextType?: string;
    planMode?: boolean;
  }): Promise<{ prompt: string; askedFor: string[] }> {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const askedFor: string[] = [];
    (deps as unknown as { planService: { getByThread: (id: string) => Promise<unknown> } }).planService = {
      getByThread: async (id: string) => {
        askedFor.push(id);
        return opts.plan ?? null;
      },
    };
    const input = makeInput();
    const thread = input.thread as unknown as { contextType: string; planMode: boolean };
    thread.contextType = opts.contextType ?? 'chat';
    thread.planMode = opts.planMode ?? false;
    await runAgentTurn(deps, input);
    return { prompt: String(hoisted.lastExecute?.systemPrompt), askedFor };
  }

  const SIX_TOOL_LINE =
    '<mcp name="plan-tools">create_plan, get_plan, update_plan, list_plan_versions, get_plan_version, mark_plan_applied</mcp>';

  it('[ac:zbqomxbo] a pinned plan reaches the prompt as M10\'s <current_plan> (path + version) — no "Current plan for this thread" block, no body, no hash; the content is left to get_plan', async () => {
    const { prompt, askedFor } = await promptFor({ plan: PINNED });
    // The turn asks the plan module for the thread's pinned plan…
    expect(askedFor).toEqual(['t1']);
    // …and hands it to the M10 block, whose shape is M10's.
    expect(prompt).toContain(
      '<current_plan path="migracja-kontraktow-wire.md" version="4">\n' +
        "The plan's content is NOT in this prompt — read it with get_plan.\n" +
        '</current_plan>',
    );
    expect(prompt.split('<current_plan ').length - 1).toBe(1);
    // The runtime's own block of 2.1.12 is gone — its header and the content it carried.
    expect(prompt).not.toContain('Current plan for this thread');
    expect(prompt).not.toContain('UNIQUE-PLAN-BODY-LINE');
    expect(prompt).not.toContain('plan-hash-85fa8219');
    // The one way to the content is mounted in the same turn.
    expect(Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>)).toContain('plan-tools');
    expect(prompt).toMatch(/<mcp name="plan-tools">[^<]*\bget_plan\b[^<]*<\/mcp>/);
  });

  it('[ac:zbqomxbo] no plan pinned to the thread → the prompt carries no plan block at all', async () => {
    const { prompt } = await promptFor({ plan: null });
    expect(prompt).not.toContain('<current_plan');
    expect(prompt).not.toContain('Current plan for this thread');
  });

  it('[ac:da1d88do#plan-tools-szesc-narzedzi] with plan-tools mounted, the <mcp name="plan-tools"> line names six tools — get_plan, update_plan, list_plan_versions, get_plan_version, mark_plan_applied and create_plan', async () => {
    // ASSUMPTION:dev-0006 — six tools (the M48 rule), not the five of `szablon-tooling-plan-tools`.
    const { prompt } = await promptFor({});
    const line = prompt.split('\n').find((l) => l.includes('<mcp name="plan-tools">')) ?? '';
    const named = /<mcp name="plan-tools">([^<]*)<\/mcp>/.exec(line)?.[1].split(', ') ?? [];
    expect(named.sort()).toEqual(
      ['get_plan', 'update_plan', 'list_plan_versions', 'get_plan_version', 'mark_plan_applied', 'create_plan'].sort(),
    );
    expect(line.trim()).toBe(SIX_TOOL_LINE);
  });

  it('[ac:i1nvq4ju] the plan-tools line stands in <tooling> iff the plan server is registered in the turn, and plan mode does not remove it', async () => {
    const off = (await promptFor({ planMode: false })).prompt;
    const on = (await promptFor({ planMode: true })).prompt;
    expect(off).toContain(SIX_TOOL_LINE);
    expect(on).toContain(SIX_TOOL_LINE);
    // Inside the tooling block, not elsewhere.
    const tooling = on.slice(on.indexOf('<tooling>'), on.indexOf('</tooling>'));
    expect(tooling).toContain(SIX_TOOL_LINE);
    // A turn whose profile registers no plan server (brief) carries no plan-tools line.
    const brief = await promptFor({ contextType: 'brief' });
    expect(Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>)).not.toContain('plan-tools');
    expect(brief.prompt).not.toContain('<mcp name="plan-tools"');
  });
});


/**
 * 2.1.57 (M44 `317cwhlj` / `kegqwiy9` / `3f5ej79s`, M13 `mbladez6`, M11 `6exnmup9`,
 * M23 `m23akc01`) — the turn handler owns the whole `mcpServers` argument and
 * builds it in three steps: the host pool (entity servers, custom servers and the
 * host's `reference-tools` / `release-tools`, registered in the pool like a
 * plugin's server), the handler's own servers by context type, and the profile
 * gate. The pool here is what `ProjectPluginHost.buildMcpServers()` hands over,
 * built from real `createMcpServer` handles whose tool names are real catalog
 * rows, so the gate classifies them as it does in production.
 */
describe('runAgentTurn — the turn argument: host pool, handler servers, profile gate (2.1.57)', () => {
  function fixture(name: string, tools: string[]) {
    return createMcpServer({
      name,
      tools: tools.map((t) =>
        mcpTool(t, `${t} fixture`, { x: z.string().optional() }, async () => ({
          content: [{ type: 'text' as const, text: t }],
        })),
      ),
    });
  }

  const POOL_FACTORIES: ReadonlyArray<readonly [string, string[]]> = [
    ['entity-tools', ['get_entities', 'create_entities']],
    ['reference-tools', ['find_references', 'create_tag']],
    ['release-tools', ['release_diff']],
  ];

  /**
   * Fresh handles per call, like the real host's factories — and, like the real
   * host, `include` is applied by NAME before a factory runs. `built` records
   * every factory invocation of the turn.
   */
  function hostPool(built: string[] = [], extra: ReadonlyArray<readonly [string, string[]]> = []) {
    return (o?: HostBuildOpts) =>
      [...POOL_FACTORIES, ...extra]
        .filter(([name]) => !o?.include || o.include(name))
        .map(([name, tools]) => {
          built.push(name);
          return { name, server: fixture(name, tools) };
        });
  }

  async function turnFor(
    contextType: string,
    opts: {
      patchPath?: string | null;
      briefPath?: string | null;
      parentThreadId?: string | null;
      planMode?: boolean;
      events?: Array<Record<string, unknown>>;
    } = {},
  ) {
    hoisted.events = opts.events ?? [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const built: string[] = [];
    (deps.pluginHost as unknown as { buildMcpServers: (o?: HostBuildOpts) => unknown }).buildMcpServers =
      hostPool(built);
    (deps as unknown as { listWorkspaceProjects: () => unknown }).listWorkspaceProjects = () => ({ projects: [] });
    (deps as unknown as { specSkillTools: SpecSkillTools }).specSkillTools = new SpecSkillTools(
      { skillsRoot: () => undefined },
      'p1',
    );
    const input = makeInput();
    const thread = input.thread as unknown as {
      contextType: string;
      patchPath: string | null;
      briefPath: string | null;
      parentThreadId: string | null;
      planMode: boolean;
    };
    thread.contextType = contextType;
    thread.patchPath = opts.patchPath ?? null;
    thread.briefPath = opts.briefPath ?? null;
    thread.parentThreadId = opts.parentThreadId ?? null;
    thread.planMode = opts.planMode ?? false;
    await runAgentTurn(deps, input);
    const servers = (hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>;
    const prompt = String(hoisted.lastExecute?.systemPrompt);
    /** The declared tools of a mounted server, read off the `<tooling>` line the inventory derives from the mount. */
    const toolsOf = (server: string): string[] | null => {
      const m = new RegExp(`<mcp name="${server}">([^<]*)</mcp>`).exec(prompt);
      return m ? m[1]!.split(',').map((t) => t.trim()) : null;
    };
    return { deps, built, mounted: Object.keys(servers).sort(), servers, prompt, toolsOf };
  }

  const CHAT_SET = [
    'c4s-tools',
    'entity-tools',
    'plan-tools',
    'reference-tools',
    'release-tools',
    'skill-tools',
    'spec-skill-tools',
    'transagent-tools',
    'workspace-tools',
  ];

  it('[section:317cwhlj] [section:kegqwiy9] the handler assembles the whole mcpServers argument: pool servers (reference-tools, release-tools with the entity servers) plus its own, one map', async () => {
    const { mounted, prompt } = await turnFor('chat');
    expect(mounted).toEqual(CHAT_SET);
    // reference-tools / release-tools come from the pool — with an empty pool the
    // handler appends neither of them on its own.
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    (deps as unknown as { listWorkspaceProjects: () => unknown }).listWorkspaceProjects = () => ({ projects: [] });
    await runAgentTurn(deps, makeInput());
    const bare = Object.keys((hoisted.lastExecute?.mcpServers ?? {}) as Record<string, unknown>);
    expect(bare).not.toContain('reference-tools');
    expect(bare).not.toContain('release-tools');
    // The inventory names the same set the adapter receives.
    for (const name of CHAT_SET) expect(prompt, name).toContain(`<mcp name="${name}"`);
  });

  it('[section:3f5ej79s] a pool entry colliding with a handler server name is replaced by the handler entry — mounted once, with the handler\'s tools', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    const built: string[] = [];
    (deps.pluginHost as unknown as { buildMcpServers: (o?: HostBuildOpts) => unknown }).buildMcpServers = hostPool(
      built,
      [['plan-tools', ['find_references']]],
    );
    await runAgentTurn(deps, makeInput());
    const prompt = String(hoisted.lastExecute?.systemPrompt);
    const lines = prompt.match(/<mcp name="plan-tools"[^\n]*/g) ?? [];
    expect(lines).toHaveLength(1);
    // The handler's plan-tools (its own plan operations), not the pool's fixture.
    expect(lines[0]).not.toContain('find_references');
    expect(lines[0]).toContain('update_plan');
    // The shadowed pool factory is never even built.
    expect(built).not.toContain('plan-tools');
    expect(built).toContain('entity-tools');
  });

  it('[section:3f5ej79s] [section:6exnmup9] ask = the pool plus plan-tools, skill-tools and workspace-tools; the profile gate cuts the write tools and leaves the reads', async () => {
    const { mounted, toolsOf } = await turnFor('ask');
    expect(mounted).toEqual(
      ['entity-tools', 'plan-tools', 'reference-tools', 'release-tools', 'skill-tools', 'workspace-tools'].sort(),
    );
    expect(toolsOf('entity-tools')).toEqual(['get_entities']);
    expect(toolsOf('reference-tools')).toEqual(['find_references']);
    // The same pool under chat keeps the writes.
    const chat = await turnFor('chat');
    expect(chat.toolsOf('entity-tools')).toEqual(['get_entities', 'create_entities']);
    expect(chat.toolsOf('reference-tools')).toEqual(['find_references', 'create_tag']);
  });

  it('[section:m23akc01] a patch thread gets the full chat set without transagent-tools — c4s-tools and spec-skill-tools included — plus patch-tools', async () => {
    const { mounted } = await turnFor('patch', { patchPath: 'p.md' });
    expect(mounted).toEqual(
      [...CHAT_SET.filter((n) => n !== 'transagent-tools'), 'patch-tools'].sort(),
    );
  });

  it('[ac:ac-mcp-ask-peer-w-posture-plan-mode-c] an ask turn runs with planMode=true whatever the thread flag says, strips c4s-tools and transagent-tools, keeps plan-tools, and mutates no spec (write tools withheld)', async () => {
    const { mounted, toolsOf } = await turnFor('ask', { planMode: false });
    expect(hoisted.lastExecute?.planMode).toBe(true);
    expect(mounted).not.toContain('c4s-tools');
    expect(mounted).not.toContain('transagent-tools');
    expect(mounted).toContain('plan-tools');
    expect(toolsOf('entity-tools')).not.toContain('create_entities');
    expect(toolsOf('reference-tools')).not.toContain('create_tag');
  });

  it('[ac:ac-mcp-server-c4s-tools-jest-whitelistowa] c4s-tools is mounted in chat and patch, and absent from brief and ask', async () => {
    expect((await turnFor('chat')).mounted).toContain('c4s-tools');
    expect((await turnFor('patch', { patchPath: 'p.md' })).mounted).toContain('c4s-tools');
    expect((await turnFor('brief', { briefPath: 'b.md' })).mounted).not.toContain('c4s-tools');
    expect((await turnFor('ask')).mounted).not.toContain('c4s-tools');
  });

  it('[ac:ac-prompt-nie-niesie-osobnego-bloku-inst] the prompt carries no separate consultation-instruction block: c4s-tools appears as an inventory line, and the call contract only in the tool description', async () => {
    const { prompt } = await turnFor('chat');
    expect(prompt).toContain('<mcp name="c4s-tools">ask</mcp>');
    expect(prompt).not.toContain('<c4s_tools_usage');
    // The contract lives in the operation's own description, which the prompt does not repeat.
    const description = buildC4sToolsServer('default').tools[0]!.description;
    expect(description.length).toBeGreaterThan(40);
    expect(prompt).not.toContain(description.slice(0, 40));
  });

  it('[ac:ac-serwer-skill-tools-jest-zamontowany-w] skill-tools is mounted in all four context types — brief included, with no filesystem built-in', async () => {
    for (const [contextType, opts] of [
      ['chat', {}],
      ['patch', { patchPath: 'p.md' }],
      ['ask', {}],
      ['brief', { briefPath: 'b.md' }],
    ] as const) {
      expect((await turnFor(contextType, opts)).mounted, contextType).toContain('skill-tools');
    }
    // The last turn was brief: no file built-ins there at all.
    const groups = hoisted.lastExecute?.disallowedToolGroups as string[];
    expect(groups).toEqual(expect.arrayContaining(['file-read', 'file-write', 'shell']));
  });

  it('[ac:ac-watek-context-type-brief-ma-zamontowa] a brief thread mounts brief-tools, release-tools and skill-tools — no entity servers, no reference-tools, no plan-tools', async () => {
    const { mounted } = await turnFor('brief', { briefPath: 'b.md' });
    for (const name of ['brief-tools', 'release-tools', 'skill-tools']) expect(mounted, name).toContain(name);
    for (const name of ['entity-tools', 'reference-tools', 'plan-tools']) expect(mounted, name).not.toContain(name);
    // ASSUMPTION:dev-0014 — the criterion says "only" these three; the M44 row at
    // 2.1.57 adds workspace-tools to every type, brief included. Built to the row:
    // workspace-tools is the one further server.
    expect(mounted).toEqual(['brief-tools', 'release-tools', 'skill-tools', 'workspace-tools']);
  });

  it('[section:3f5ej79s] a brief turn builds only the pool servers it mounts — no entity-tools / reference-tools factory runs, on any buildMcpEntries call', async () => {
    const { built } = await turnFor('brief', { briefPath: 'b.md' });
    // `<tooling>` + one execute: release-tools built each time, nothing else.
    expect(built.length).toBeGreaterThan(0);
    expect(new Set(built)).toEqual(new Set(['release-tools']));
    // A chat turn, by contrast, builds the whole pool.
    const chat = await turnFor('chat');
    expect(new Set(chat.built)).toEqual(new Set(['entity-tools', 'reference-tools', 'release-tools']));
  });

  it('[section:3f5ej79s] the pool narrowing is driven by the registry row (ctx.mcp.pluginServers), not by a second table', async () => {
    const row = CONTEXT_TYPE_REGISTRY.chat.mcp;
    const original = row.pluginServers;
    row.pluginServers = 'release-only';
    try {
      const { built, mounted } = await turnFor('chat');
      expect(new Set(built)).toEqual(new Set(['release-tools']));
      expect(mounted).not.toContain('entity-tools');
      expect(mounted).not.toContain('reference-tools');
      expect(mounted).toContain('release-tools');
    } finally {
      row.pluginServers = original;
    }
  });

  it('[ac:ac-watek-context-type-brief-nie-ma-zamon] a brief thread has neither c4s-tools nor transagent-tools mounted', async () => {
    const { mounted, prompt } = await turnFor('brief', { briefPath: 'b.md' });
    expect(mounted).not.toContain('c4s-tools');
    expect(mounted).not.toContain('transagent-tools');
    expect(prompt).not.toMatch(/<mcp name="(c4s|transagent)-tools"/);
  });

  it('[ac:ac-watek-context-type-brief-niesie-posta] a brief thread carries its tool posture (cwd, no filesystem writes, no plan/entity tools) inside <interaction_context type="brief">', async () => {
    const { prompt } = await turnFor('brief', { briefPath: 'b.md' });
    const block = /<interaction_context type="brief">([\s\S]*?)<\/interaction_context>/.exec(prompt)?.[1];
    expect(block).toBeDefined();
    expect(block).toContain('You work at the project cwd');
    expect(block).toContain('no writes');
    expect(block).toContain('You have NO plan tools and NO entity tools.');
  });

  it('[ac:ac-watek-context-type-patch-ma-zamontowa] a patch thread has patch-tools mounted', async () => {
    const { mounted, toolsOf } = await turnFor('patch', { patchPath: 'p.md' });
    expect(mounted).toContain('patch-tools');
    expect(toolsOf('patch-tools')).toEqual(['get_patch', 'mark_patch_applied']);
  });

  it('[ac:ac-watek-dziecko-w-typie-ktorego-wiersz] a child thread of a type whose row names the orchestrator (chat) has transagent-tools stripped — the thread flag wins over the row', async () => {
    // The row: chat names transagent-tools.
    expect(CONTEXT_TYPE_REGISTRY.chat.mcp.transagentTools).toBe(true);
    const top = await turnFor('chat', { parentThreadId: null });
    expect(top.mounted).toContain('transagent-tools');
    // The thread: a child of the same type does not get it.
    const child = await turnFor('chat', { parentThreadId: 'parent-1' });
    expect(child.mounted).not.toContain('transagent-tools');
    expect(child.prompt).not.toMatch(/<mcp name="transagent-tools"/);
  });

  it('[ac:ac-watki-context-type-chat-brief-ask-nie] chat, brief and ask threads have no patch-tools mounted — even with a patch path on the row', async () => {
    for (const [contextType, opts] of [
      ['chat', { patchPath: 'p.md' }],
      ['brief', { briefPath: 'b.md', patchPath: 'p.md' }],
      ['ask', { patchPath: 'p.md' }],
    ] as const) {
      const { mounted, prompt } = await turnFor(contextType, opts);
      expect(mounted, contextType).not.toContain('patch-tools');
      expect(prompt, contextType).not.toMatch(/<mcp name="patch-tools"/);
    }
  });

  it('[ac:ac-wywolanie-narzedzia-spoza-whitelisty] a call to a tool outside the type\'s whitelist: its server is not registered in the runtime, and the runtime\'s answer reaches the model as a tool_result error', async () => {
    // A brief thread calling an entity tool: entity-tools is in the pool, not in brief's set.
    const { mounted, prompt, deps } = await turnFor('brief', {
      briefPath: 'b.md',
      events: [
        { type: 'tool_use', toolName: 'mcp__entity-tools__get_entities', toolUseId: 'u1', input: {} },
        { type: 'tool_result', toolUseId: 'u1', summary: 'Tool not available in this context', isError: true },
        { type: 'text_delta', text: 'done' },
        { type: 'result', sessionId: 's1' },
      ],
    });
    expect(mounted).not.toContain('entity-tools');
    expect(prompt).not.toMatch(/<mcp name="[^"]*">[^<]*\bget_entities\b/);
    // ASSUMPTION:dev-0014 — the wording is the agent runtime's own answer to a call on an
    // unregistered tool; the app guarantees the non-registration and passes the error on.
    const rows = (deps.chatService as unknown as {
      getMessages: () => Array<{ role: string; content: string }>;
    }).getMessages();
    const result = rows.find((r) => r.role === 'tool_result');
    expect(result).toBeDefined();
    expect(JSON.parse(result!.content)).toEqual({ summary: 'Tool not available in this context', isError: true });
  });

  it('[section:kaasgyj8] [section:55dy5doq] <tooling> is an inventory of names derived from the mount alone — it states no schema, and the turn passes the adapter no deferral control, in any context type', async () => {
    for (const [contextType, opts] of [
      ['chat', {}],
      ['patch', { patchPath: 'p.md' }],
      ['ask', {}],
      ['brief', { briefPath: 'b.md' }],
    ] as const) {
      const { mounted, prompt } = await turnFor(contextType, opts);
      // Anchored on the block's own lines: rule text (BRIEF_RULES) mentions `<tooling>` inline.
      const tooling = /(?:^|\n)<tooling>\n([\s\S]*?)\n<\/tooling>/.exec(prompt)?.[1] ?? '';
      expect(tooling, contextType).not.toBe('');
      // One <mcp> line per mounted server, in the mount — nothing else, no schema.
      const named = [...tooling.matchAll(/<mcp name="([^"]+)"/g)].map((m) => m[1]).sort();
      expect(named, contextType).toEqual(mounted);
      expect(tooling, contextType).not.toMatch(/inputSchema|"type":\s*"object"/);
      // No execute parameter steers schema deferral (the SDK decides it on its own).
      expect(Object.keys(hoisted.lastExecute ?? {}).filter((k) => /defer|lazy|toolsearch/i.test(k)), contextType).toEqual([]);
    }
  });
});

/**
 * 2.1.56 (M05 Agent Runtime, `4fc4hute` / `c47xltl5`) — what the turn stream
 * carries, and the hold window as a running turn. Driven through `runAgentTurn`
 * with the stream the claude-code adapter produces; the transport (SSE of
 * `POST /api/chat`) is `input.onEvent`, a live joiner is the registry emitter.
 */
describe('runAgentTurn — the turn stream (2.1.56)', () => {
  type LiveView = {
    emitter: { on: (name: string, fn: (e: Record<string, unknown>) => void) => void };
    replay: { events: Array<Record<string, unknown>> };
  };
  const activeOf = (deps: AgentTurnDeps, threadId = 't1') =>
    (deps.activeAdapters as unknown as Map<string, LiveView>).get(threadId)!;

  /** Records what the POST sender gets, what a joiner gets, and the replay at the last event. */
  function capture(deps: AgentTurnDeps, input: AgentTurnInput) {
    const live: Array<Record<string, unknown>> = [];
    const joined: Array<Record<string, unknown>> = [];
    const view = { replay: [] as Array<Record<string, unknown>> };
    input.onEvent = (e) => live.push(e as Record<string, unknown>);
    let attached = false;
    hoisted.beforeEvent = (event) => {
      const active = activeOf(deps);
      if (!attached) {
        active.emitter.on('event', (e) => joined.push(e));
        attached = true;
      }
      if (event.type === 'result') view.replay = [...active.replay.events];
    };
    return { live, joined, view };
  }

  it('[ac:ac-zdarzenia-background-task-started-pro] forwards background_task_started, _progress and _completed over the stream', async () => {
    hoisted.events = [
      { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'npm run build' },
      { type: 'background_task_progress', taskId: 'bg1', taskType: 'shell', description: 'compiling' },
      { type: 'background_task_completed', taskId: 'bg1', taskType: 'shell', status: 'success', summary: 'built' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const input = makeInput();
    const { live, joined } = capture(deps, input);

    await runAgentTurn(deps, input);

    const background = (events: Array<Record<string, unknown>>) =>
      events.filter((e) => String(e.type).startsWith('background_task_'));
    for (const stream of [live, joined]) {
      expect(background(stream).map((e) => [e.type, e.taskId])).toEqual([
        ['background_task_started', 'bg1'],
        ['background_task_progress', 'bg1'],
        ['background_task_completed', 'bg1'],
      ]);
    }
    expect(background(live)[1]).toMatchObject({ description: 'compiling' });
    expect(background(live)[2]).toMatchObject({ status: 'success', summary: 'built' });
  });

  it('[ac:ac-zmiany-listy-zadan-modelu-docieraja-d] model task-list changes reach the client as todo_list_updated carrying the ready list', async () => {
    // What the adapter emits for the two shapes of the family: `Task*` merged per
    // item (the event already carries the merged list), `TodoWrite` replacing it.
    const merged = [
      { id: 'toolu_a', content: 'Read M05', status: 'completed' },
      { id: 'toolu_b', content: 'Write the tests', status: 'in_progress' },
    ];
    const replaced = [{ id: 'todo-0', content: 'Ship it', status: 'pending' }];
    hoisted.events = [
      { type: 'todo_list_updated', items: merged, source: 'model-tool', isSubagent: false },
      { type: 'text_delta', text: 'Working.' },
      { type: 'todo_list_updated', items: replaced, source: 'model-tool', isSubagent: false },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const persisted = vi.spyOn(
      deps.chatService as unknown as { updateCurrentTodoItems: (...a: unknown[]) => void },
      'updateCurrentTodoItems',
    );
    const input = makeInput();
    const { live, joined, view } = capture(deps, input);

    await runAgentTurn(deps, input);

    // Each change is its own event with the whole list — the client never merges.
    for (const stream of [live, joined, view.replay]) {
      expect(stream.filter((e) => e.type === 'todo_list_updated').map((e) => e.items)).toEqual([merged, replaced]);
    }
    expect(persisted.mock.calls).toEqual([
      ['t1', merged],
      ['t1', replaced],
    ]);
  });

  it('[ac:ac-echo-tool-result-rodziny-task-nie-tra] the tool_result echo of the Task* family does not reach the turn stream', async () => {
    // A `TaskCreate` round-trip as the claude-code adapter delivers it: the call
    // becomes `todo_list_updated`, and its tool_result echo is swallowed — while an
    // ordinary tool keeps its tool_use / tool_result pair.
    expect(CLAUDE_CODE_TASK_TRACKING_TOOLS).toContain('TaskCreate');
    hoisted.events = [
      {
        type: 'todo_list_updated',
        items: [{ id: 'toolu_task', content: 'Read M05', status: 'pending' }],
        source: 'model-tool',
        isSubagent: false,
      },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'toolu_read', input: { file_path: 'a.md' }, isSubagent: false },
      { type: 'tool_result', toolUseId: 'toolu_read', summary: 'contents', isSubagent: false },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const input = makeInput();
    const { live, joined, view } = capture(deps, input);

    await runAgentTurn(deps, input);

    for (const stream of [live, joined, view.replay]) {
      // No card and no result for the task call — not even a synthesized one.
      expect(stream.filter((e) => e.toolUseId === 'toolu_task')).toEqual([]);
      expect(stream.filter((e) => e.type === 'tool_result').map((e) => e.toolUseId)).toEqual(['toolu_read']);
      expect(stream.filter((e) => e.type === 'todo_list_updated')).toHaveLength(1);
    }
    // Nor is a tool row persisted for it, so nothing waits on a result that never comes.
    const rows = (deps.chatService as unknown as { getMessages: () => Array<{ role: string; content: string }> })
      .getMessages()
      .filter((r) => r.role === 'tool_use' || r.role === 'tool_result');
    expect(rows.map((r) => r.role)).toEqual(['tool_use', 'tool_result']);
  });

  it('[ac:ac-zdarzenia-rodziny-scheduling-schedule] events of the scheduling family (ScheduleWakeup, Cron*, /loop) never reach the SSE stream', async () => {
    // The adapter the turn runs on denies the family outright — the contract the
    // stream relies on, pinned here so a library upgrade that drops it fails.
    expect([...CLAUDE_CODE_SUPPRESSED_HARNESS_TOOLS].sort()).toEqual(
      ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'].sort(),
    );
    hoisted.events = [
      { type: 'text_delta', text: 'Polling the build. ' },
      { type: 'tool_use', toolName: 'Monitor', toolUseId: 'toolu_mon', input: { command: 'tail -f build.log' }, isSubagent: false },
      { type: 'tool_result', toolUseId: 'toolu_mon', summary: 'started', isSubagent: false },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const input = makeInput();
    const { live, joined } = capture(deps, input);

    await runAgentTurn(deps, input);

    const scheduling = /ScheduleWakeup|Cron(Create|List|Delete)|\/loop/;
    for (const stream of [live, joined]) {
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.filter((e) => scheduling.test(JSON.stringify(e)))).toEqual([]);
    }
  });

  describe('the hold window is a running turn for the queue', () => {
    let db: Database.Database;
    let real: ChatService;
    let threadId: string;

    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      real = new ChatService(db);
      threadId = real.createThread('t').id;
    });
    afterEach(() => db.close());

    it('[ac:ac-post-api-chat-queue-threadid-na-watek-2] POST /api/chat/queue/:threadId is 409 NO_ACTIVE_STREAM with no turn, and 202 between a held result and its continuation', async () => {
      const { default: express } = await import('express');
      const { default: request } = await import('supertest');
      const { chatRouter } = await import('./chat.js');
      const { deps } = makeDeps();
      const cs = deps.chatService as unknown as Record<string, unknown>;
      cs.countQueued = real.countQueued.bind(real);
      cs.enqueueQueued = real.enqueueQueued.bind(real);
      cs.listQueued = real.listQueued.bind(real);
      cs.removeQueued = real.removeQueued.bind(real);
      // One process: the queue route and the turn share the registry of active turns.
      const app = express().use(express.json()).use('/api/chat', chatRouter(deps));
      const enqueue = (prompt: string) => request(app).post(`/api/chat/queue/${threadId}`).send({ prompt });

      hoisted.events = [
        { type: 'text_delta', text: 'Backgrounding. ' },
        { type: 'background_task_started', taskId: 'bg1', taskType: 'shell', description: 'sleep 5' },
        { type: 'result', sessionId: 's-held', backgroundTasks: [{ taskId: 'bg1', taskType: 'shell' }] },
        { type: 'background_task_completed', taskId: 'bg1', taskType: 'shell', status: 'success' },
        { type: 'text_delta', text: 'Continuation.' },
        { type: 'result', sessionId: 's-final' },
      ];
      let heldResultSeen = false;
      let inHold: Awaited<ReturnType<typeof enqueue>> | null = null;
      hoisted.beforeEvent = async (event) => {
        // Runs once the held `result` has been consumed and before the
        // continuation starts: the hold window.
        if (heldResultSeen && !inHold) inHold = await enqueue('sent while held');
        if (event.type === 'result' && event.sessionId === 's-held') heldResultSeen = true;
      };
      const input = makeInput();
      input.thread = { ...input.thread, id: threadId } as AgentTurnInput['thread'];

      const before = await enqueue('no turn yet');
      await runAgentTurn(deps, input);
      const after = await enqueue('turn over');

      expect(before.status).toBe(409);
      expect(before.body.error.code).toBe('NO_ACTIVE_STREAM');
      expect(inHold).not.toBeNull();
      expect(inHold!.status).toBe(202);
      expect(inHold!.body.queued.map((q: { text: string }) => q.text)).toEqual(['sent while held']);
      expect(after.status).toBe(409);
      expect(after.body.error.code).toBe('NO_ACTIVE_STREAM');
    });
  });
});
