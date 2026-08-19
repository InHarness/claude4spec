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
  agent: undefined as { allowedPaths?: string[]; disallowedPaths?: string[] } | undefined,
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
    readConfig: (cwd: string) => ({ ...actual.readConfig(cwd), agent: hoisted.agent }),
  };
});

import { runAgentTurn, type AgentTurnDeps, type AgentTurnInput } from './agent-turn.js';

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

    // planMode=false ⇒ the adapter is handed no READONLY_BUILTINS allow-list and
    // no MUTATING_BUILTINS ban, i.e. the full built-in toolset.
    expect(hoisted.lastExecute?.planMode).toBe(false);
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
    // The host's factories are re-invoked, not memoized for the turn.
    expect(built).toBe(2);
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
      resolve: () => [],
      // Mirrors the real resolveForContext, which since 0.2.19 takes the CONTEXT
      // TYPE and reads the attach list off the registry itself: `chat` attaches
      // `writing-style-author`, every other type attaches nothing hardcoded. An
      // unknown slug degrades (bundled roots only rescan at server boot, so a slug
      // missing from a running process's cache must not fail every turn). The
      // active writing style, if any, is appended last.
      resolveForContext: (contextType: string) => {
        const attach = contextType === 'chat' ? ['writing-style-author'] : [];
        const toInline = (slug: string) => {
          const r = skillRegistry.resolve(slug);
          return { name: slug, description: r.metadata.description, content: r.content, files: r.files, metadata: { title: r.metadata.title, version: 1, language: 'en', scope: r.metadata.scope } };
        };
        const out = attach.flatMap((slug) => (slug in skills ? [toInline(slug)] : []));
        for (const [slug, s] of Object.entries(skills)) {
          if (s.scope === 'writing-style' && !out.some((o) => o.name === slug)) out.push(toInline(slug));
        }
        return out;
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

    const skillNames = ((hoisted.lastExecute?.skills ?? []) as Array<{ name: string }>).map((s) => s.name);
    expect(skillNames).toEqual([]);
    expect(String(hoisted.lastExecute?.systemPrompt)).not.toContain('<project_skill');
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

  it('chat thread: writing-style-author is in inlineSkills but produces NO <project_skill> block', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({
      'writing-style-author': { title: 'Writing Style Author', description: 'authors styles' },
    }));
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'chat';

    await runAgentTurn(deps, input);

    const skillNames = ((hoisted.lastExecute?.skills ?? []) as Array<{ name: string }>).map((s) => s.name);
    expect(skillNames).toContain('writing-style-author');
    expect(String(hoisted.lastExecute?.systemPrompt)).not.toContain('<project_skill slug="writing-style-author"');
  });

  it('the active writing style is the one skill that gets the <project_skill> block', async () => {
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
    expect(prompt).toContain('<project_skill slug="house-style"');
    expect(prompt.match(/<project_skill /g)?.length).toBe(1);
  });

  it('a missing bundled attach-list skill degrades gracefully (no crash, no <project_skill> block for it) instead of failing every turn', async () => {
    hoisted.events = [{ type: 'text_delta', text: 'ok' }, { type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();
    Object.assign(deps, fakeSkillDeps({})); // simulates a stale/not-yet-restarted process.
    const input = makeInput();
    (input.thread as unknown as { contextType: string }).contextType = 'chat';

    const result = await runAgentTurn(deps, input);

    expect(result.answer).toBe('ok');
    const skillNames = ((hoisted.lastExecute?.skills ?? []) as Array<{ name: string }>).map((s) => s.name);
    expect(skillNames).not.toContain('writing-style-author');
    expect(String(hoisted.lastExecute?.systemPrompt)).not.toContain('<project_skill');
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

  it('leaves timeoutMs unset when the caller omits it (interactive chat must stay unbounded)', async () => {
    hoisted.events = [{ type: 'result', sessionId: 's1' }];
    const { deps } = makeDeps();

    await runAgentTurn(deps, makeInput());

    expect('timeoutMs' in (hoisted.lastExecute ?? {})).toBe(false);
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
      ['c4s-tools', 'plan-tools', 'transagent-tools', 'workspace-tools'].sort(),
    );
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
