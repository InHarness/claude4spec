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
  /** Runs before each event is yielded — lets a test change the world mid-stream. */
  beforeEvent: null as ((event: Record<string, unknown>, opts: Record<string, unknown>) => void) | null,
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
          hoisted.beforeEvent?.(e, opts);
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
  AdapterTimeoutError,
} from '@inharness-ai/agent-adapters';
import { runAgentTurn, type AgentTurnDeps, type AgentTurnInput } from './agent-turn.js';
import { BACKGROUND_HOLD_CAP_MS, TURN_TIMEOUT_MS } from '../../shared/agent-turn.js';

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
    setLastUsage: () => {},
    setLastSessionId: () => {},
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

  return { deps, messages, snapshots };
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
        return { metadata: { slug, title: s.title, description: s.description, version: 1, language: 'en', scope: s.scope ?? 'contextual', source: 'bundled', path: '' }, content: `${slug} body`, files: {} };
      },
    };
    const skillResolver = {
      resolveWritingStyle: () => null,
      // Mirrors the real resolveForContext, which since 0.2.19 takes the CONTEXT
      // TYPE and reads the attach list off the registry itself: `chat` attaches
      // `writing-style-author`, every other type attaches nothing hardcoded. An
      // unknown slug degrades (bundled roots only rescan at server boot, so a slug
      // missing from a running process's cache must not fail every turn).
      //
      // 0.2.36: it answers METADATA — a `listing` for `<available_skills>` and the
      // writing style as its OWN field, never as a listing row.
      resolveForContext: (contextType: string) => {
        const attach = contextType === 'chat' ? ['writing-style-author'] : [];
        const styleSlug = Object.entries(skills).find(([, s]) => s.scope === 'writing-style')?.[0];
        const listing = attach
          .filter((slug) => slug in skills && slug !== styleSlug)
          .map((slug) => ({ slug, description: skills[slug]!.description }));
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
    expect(prompt).toContain('<skill slug="writing-style-author" description="authors styles"/>');
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

  it('a missing bundled attach-list skill degrades gracefully (no crash, no <project_skill> block for it) instead of failing every turn', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({})); // simulates a stale/not-yet-restarted process.
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'chat';

    const result = await runAgentTurn(deps, input);

    expect(result.answer).toBe('ok');
    const prompt = String(hoisted.lastExecute?.systemPrompt);
    expect(prompt).not.toContain('<skill slug="writing-style-author"');
    expect(prompt).not.toContain('<project_skill');
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
  it('[ac:ac-wartosc-timeoutms-przekazywana-do-ada] keeps the turn timeout strictly above the background hold cap', () => {
    expect(TURN_TIMEOUT_MS).toBeGreaterThan(BACKGROUND_HOLD_CAP_MS);
  });

  /**
   * The library treats `null`/`Infinity` as a sentinel meaning "disarm the
   * cap", which would let a wedged background task hold a session open with no
   * bound at all.
   */
  it('[ac:ac-wartosc-timeoutms-przekazywana-do-ada] arms the hold cap with a finite positive number, never a disarm sentinel', async () => {
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
  it('persists background_task_* events and never emits/finalizes a held result', async () => {
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

    // Only the genuine final result reaches the client — the held one is suppressed,
    // so agent-chat's reducer never finalizes isStreaming / sums usage on it.
    const emittedResults = emitted.filter((e) => e.type === 'result');
    expect(emittedResults).toHaveLength(1);
    expect(emittedResults[0].sessionId).toBe('s-final');

    // The background_task_* events themselves DO reach the client (rendered as a panel).
    expect(emitted.filter((e) => e.type === 'background_task_started')).toHaveLength(1);
    expect(emitted.filter((e) => e.type === 'background_task_completed')).toHaveLength(1);

    // Held result still advances the session anchor; final result advances it again.
    expect(setSession).toHaveBeenCalledWith('t1', 's-held');
    expect(setSession).toHaveBeenCalledWith('t1', 's-final');
  });

  /**
   * 0.2.50 — a held `result` must NOT close the turn's usage snapshot.
   *
   * `attachTurnUsage` is the closing write: it stamps usage onto the turn's
   * anchor row. Calling it on a held result would publish a partial figure as
   * final, and the continuation turn's own `result` would then either
   * double-count or be ignored. `setLastUsage` is a separate "latest wins"
   * scratch write and is allowed to run on every result.
   */
  it('defers attachTurnUsage until the terminal result, not the held one', async () => {
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

    // Exactly once — for the terminal result, never for the held one.
    expect(attach).toHaveBeenCalledTimes(1);
    const [, , usage] = attach.mock.calls[0] as [string, number, { outputTokens: number }];
    expect(usage.outputTokens).toBe(8);
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

describe('runAgentTurn — 0.2.50 turn-lifecycle contract', () => {
  /**
   * `adapter_ready` is an INTERNAL delimiter. Forwarding it would put an event
   * on the wire that renders nothing and that the client's mapper has no branch
   * for; the client's real "an iteration began" marker is `turn_start`.
   */
  it('consumes adapter_ready internally instead of forwarding it', async () => {
    hoisted.events = [
      { type: 'adapter_ready', adapter: 'claude-code', sdkConfig: { model: 'opus' } },
      { type: 'text_delta', text: 'hi' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps } = makeDeps();
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    await runAgentTurn(deps, input);

    expect(emitted.filter((e) => e.type === 'adapter_ready')).toHaveLength(0);
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
  it('accepts a side-band warning that arrives after the terminal result', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'answer' },
      { type: 'result', sessionId: 's1' },
      { type: 'warning', message: 'scope degraded to soft enforcement' },
    ];
    const { deps } = makeDeps();
    const emitted: Array<Record<string, unknown>> = [];
    const input = makeInput();
    input.onEvent = (e) => emitted.push(e as Record<string, unknown>);

    const result = await runAgentTurn(deps, input);

    expect(result.answer).toBe('answer');
    expect(emitted.filter((e) => e.type === 'warning')).toHaveLength(1);
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
    hoisted.events = [
      bigResult('tu-1'),
      bigResult('tu-2'),
      bigResult('tu-3'),
      bigResult('tu-4'),
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
  it('persists a warning as its own complete row and forwards it to the client', async () => {
    hoisted.events = [
      { type: 'text_delta', text: 'Starting. ' },
      { type: 'warning', message: 'filesystem scope degraded to soft enforcement' },
      { type: 'text_delta', text: 'Done.' },
      { type: 'result', sessionId: 's1' },
    ];
    const { deps, messages } = makeDeps();
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
  async function mountedFor(contextType: string): Promise<string[]> {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    // The rig is built without a workspace, and workspace-tools mounts only when
    // one is present — supply it, since it is the server these tests are about.
    (deps as unknown as { listWorkspaceProjects: () => unknown }).listWorkspaceProjects = () => ({
      projects: [],
    });
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = contextType;
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

  it('workspace-tools survives the gate for every profile — list_projects is read-class', async () => {
    for (const contextType of ['chat', 'ask', 'patch']) {
      expect(await mountedFor(contextType)).toContain('workspace-tools');
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
      // Refused BEFORE dispatch: the adapter was never asked to run.
      expect(hoisted.executes).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
