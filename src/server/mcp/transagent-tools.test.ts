import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTransagentToolsServer } from './transagent-tools.js';
import { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import type { AgentTurnDeps, AgentTurnInput } from '../routes/agent-turn.js';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from '../services/chat.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { AgentTurnError } from '../../shared/agent-turn.js';
import { DomainError } from '../services/tags.js';
import { CONTEXT_TYPE_REGISTRY } from '../services/chat-context.js';
import { PROFILES } from '../operations/profiles.js';

/**
 * `runTransagent`'s error taxonomy — the boundary where a CHILD turn's failure
 * becomes the parent's `tool_result`.
 *
 * Every case here is about a distinction that used to be lost. The handler
 * narrowed on `DomainError` alone, so the child turn's own `AgentTurnError`
 * codes — the ones that say whether a human stopped it, whether it ran out of
 * time, or whether it never started — all fell through to the default and
 * reached the parent agent as an undifferentiated `AGENT_ERROR`. A parent
 * cannot decide whether to retry from that.
 *
 * The tool is exercised through its real handler rather than through a spy on
 * the mapping helper: the collapse happened in the `catch`, which is the part
 * a unit test of the helper would not have run.
 */
describe('runTransagent — error taxonomy', () => {
  /** The tool, wired to a dispatcher that does nothing but throw `err`. */
  const toolThatThrows = (err: unknown) => {
    const dispatcher = {
      run: async () => {
        throw err;
      },
    } as unknown as TransagentDispatcher;
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    const tool = server.tools.find((t) => t.name === 'runTransagent');
    if (!tool) throw new Error('runTransagent not registered');
    return tool;
  };

  const callAndParse = async (err: unknown) => {
    const result = (await toolThatThrows(err).handler({
      contextType: 'chat',
      message: 'go',
      planMode: false,
    })) as { isError?: boolean; content: Array<{ text: string }> };
    return {
      isError: result.isError,
      body: JSON.parse(result.content[0]!.text) as Record<string, unknown>,
    };
  };

  /**
   * The headline. `ABORTED` means a human pressed stop — retrying is the wrong
   * response, and `AGENT_ERROR` invites exactly that.
   */
  it('surfaces a child ABORTED as ABORTED, not AGENT_ERROR', async () => {
    const { isError, body } = await callAndParse(new AgentTurnError('ABORTED', 'Aborted by user'));
    expect(isError).toBe(true);
    expect(body.code).toBe('ABORTED');
    expect(body.error).toBe('Aborted by user');
  });

  /**
   * 0.2.107: a bubble that went silent is stopped by ITS OWN idle clock and comes
   * back as a tool error — the parent's turn is not ended by it.
   */
  it('[ac:ac-banka-milczaca-dluzej-niz-zegar-idle] surfaces a child stopped by its own idle clock as isError IDLE_TIMEOUT', async () => {
    const { isError, body } = await callAndParse(
      new AgentTurnError('IDLE_TIMEOUT', 'Agent went idle for 60 min with nothing in flight — the turn was stopped'),
    );
    expect(isError).toBe(true);
    expect(body.code).toBe('IDLE_TIMEOUT');
    expect(body.code).not.toBe('ABORTED');
  });

  it('surfaces a child TIMEOUT as TIMEOUT', async () => {
    const { body } = await callAndParse(new AgentTurnError('TIMEOUT', 'Agent took too long to respond'));
    expect(body.code).toBe('TIMEOUT');
  });

  /**
   * Not in the brief's list, and passed through deliberately: a child that
   * never started is the one failure worth retrying unchanged, and folding it
   * into `AGENT_ERROR` is what hides that. `ask` reports it for the same reason.
   */
  it('surfaces AGENT_UNAVAILABLE rather than folding it into AGENT_ERROR', async () => {
    const { body } = await callAndParse(new AgentTurnError('AGENT_UNAVAILABLE', 'no runtime'));
    expect(body.code).toBe('AGENT_UNAVAILABLE');
  });

  it('keeps a dispatcher NOT_FOUND as NOT_FOUND', async () => {
    const { body } = await callAndParse(new DomainError('NOT_FOUND', "child thread 'x' not found"));
    expect(body.code).toBe('NOT_FOUND');
  });

  /**
   * `VALIDATION` is the repo-wide SERVICE code for a bad argument; this tool's
   * documented contract says `INVALID_ARGS`. The rename happens at the tool
   * boundary so the service's vocabulary — shared with tags, entities and
   * everything else — is left alone.
   */
  it('renames a dispatcher VALIDATION to INVALID_ARGS', async () => {
    const { body } = await callAndParse(
      new DomainError('VALIDATION', "contextType='patch' requires payload.patchPath"),
    );
    expect(body.code).toBe('INVALID_ARGS');
  });

  /**
   * 0.2.111: the two continuation refusals reach the parent under their own codes —
   * one says "wait for the running turn", the other "spawn a fresh banka".
   */
  it('passes STREAM_IN_PROGRESS and RESUME_CONFIG_LOCKED through with their hint', async () => {
    const busy = await callAndParse(new DomainError('STREAM_IN_PROGRESS', 'banka busy'));
    expect(busy.isError).toBe(true);
    expect(busy.body.code).toBe('STREAM_IN_PROGRESS');
    const locked = await callAndParse(
      new DomainError('RESUME_CONFIG_LOCKED', 'config changed', 'Spawn a fresh banka (omit `threadId`)'),
    );
    expect(locked.body.code).toBe('RESUME_CONFIG_LOCKED');
    expect(locked.body.hint).toMatch(/fresh banka/);
  });

  it('carries RESUME_CONFIG_LOCKED violations structured in the tool error', async () => {
    const violations = [{ path: 'model', reason: 'immutable on resume' }];
    const { body } = await callAndParse(
      Object.assign(new DomainError('RESUME_CONFIG_LOCKED', 'config changed', 'Spawn a fresh banka'), { violations }),
    );
    expect(body.violations).toEqual(violations);
  });

  /** A hint is the half of the error that says which call would have worked. */
  it('forwards a DomainError hint, which the handler used to drop', async () => {
    const { body } = await callAndParse(
      new DomainError('NOT_FOUND', 'no such thread', 'runTransagent({ threadId: "…" })'),
    );
    expect(body.hint).toBe('runTransagent({ threadId: "…" })');
  });

  /**
   * The default has to stay `AGENT_ERROR` rather than becoming `INTERNAL`: an
   * unrecognised throw from a child turn is still the child failing, not this
   * server faulting.
   */
  it('defaults an unrecognised error to AGENT_ERROR', async () => {
    const { body } = await callAndParse(new Error('kaboom'));
    expect(body.code).toBe('AGENT_ERROR');
    expect(body.error).toBe('kaboom');
  });

  it('reports a non-Error throw without losing its text', async () => {
    const { body } = await callAndParse('plain string failure');
    expect(body.code).toBe('AGENT_ERROR');
    expect(body.error).toBe('plain string failure');
  });

  /** The success path still returns the dispatcher's result verbatim. */
  it('returns { threadId, summary } unchanged when the child succeeds', async () => {
    const dispatcher = {
      run: async () => ({ threadId: 'child_1', summary: 'did the thing' }),
    } as unknown as TransagentDispatcher;
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    const tool = server.tools.find((t) => t.name === 'runTransagent')!;
    const result = (await tool.handler({ contextType: 'chat', message: 'go', planMode: false })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      threadId: 'child_1',
      summary: 'did the thing',
    });
  });
});

/**
 * Brief 0-2-89-to-next M46: the description string is the only place a parent
 * agent can learn that `contextType='chat'` takes a payload at all. The binding
 * being implemented in the dispatcher is half the fix — an undocumented key is
 * one nobody passes.
 */
describe('runTransagent — documented chat payload', () => {
  const description = (): string => {
    const dispatcher = { run: async () => ({ threadId: 'c', summary: '' }) } as unknown as TransagentDispatcher;
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    const tool = server.tools.find((t) => t.name === 'runTransagent');
    if (!tool) throw new Error('runTransagent not registered');
    return tool.description ?? '';
  };

  it('names planPath as the chat payload key, alongside the brief and patch payloads', () => {
    const text = description();
    expect(text).toContain('planPath');
    // Still documents the other two — this is an addition, not a replacement.
    expect(text).toContain('fromReleaseName');
    expect(text).toContain('patchPath');
  });

  it('states both outcomes: omitted ⇒ the child makes its own plan, unknown path ⇒ INVALID_ARGS', () => {
    const text = description();
    expect(text).toMatch(/update_plan/);
    expect(text).toMatch(/existing plan is INVALID_ARGS/);
  });
});

/**
 * 0.2.111 (M46): the contract a parent agent reads — every call founds a new child,
 * a continuation resumes the referenced banka's session, and the id to keep working
 * with is the one returned most recently.
 */
describe('runTransagent — continuation contract (0.2.111)', () => {
  const tool = () => {
    const dispatcher = { run: async () => ({ threadId: 'c', summary: '' }) } as unknown as TransagentDispatcher;
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    const t = server.tools.find((x) => x.name === 'runTransagent');
    if (!t) throw new Error('runTransagent not registered');
    return t;
  };

  it('describes resume semantics and the two new refusals', () => {
    const text = tool().description ?? '';
    expect(text).toContain('Resumable: pass `threadId` to resume the session of an existing banka.');
    expect(text).toContain('Every call, spawn or');
    expect(text).toMatch(/pass the `threadId` returned most\s+recently/);
    expect(text).toContain('STREAM_IN_PROGRESS');
    expect(text).toContain('RESUME_CONFIG_LOCKED');
    expect(text).not.toMatch(/someone else's child/);
  });
});

/**
 * 2.1.18 (M44 `3f5ej79s`, M23 `jbcb06l2`) — the tool's contract as registered, and
 * the mount boundary its `logic` names: "tool only in a top-level 'chat' thread".
 * The boundary is held by the mount (the registry's declared `transagentTools`
 * column + the child-thread strip in agent-turn.ts), not by the handler; the
 * per-turn half is asserted in agent-turn.test.ts.
 */
describe('transagent-tools · runTransagent — contract (2.1.18)', () => {
  const tool = () => {
    const dispatcher = { run: async () => ({ threadId: 'c', summary: 's' }) } as unknown as TransagentDispatcher;
    const server = buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher });
    return { server, tool: server.tools.find((x) => x.name === 'runTransagent') };
  };

  it('[entity:transagent-tools-runtransagent] registers runTransagent on transagent-tools with its five params, mounted only by the chat row of the registry', async () => {
    const { server, tool: t } = tool();
    // A rig without the patch set mounts runTransagent alone; the turn handler
    // also passes `patches`, `briefs` and `plans`, adding `list_patches` / `list_briefs` / `list_plans` (asserted in their own files).
    expect(server.tools.map((x) => x.name)).toEqual(['runTransagent']);
    expect(t).toBeDefined();

    // Params: contextType + message required; payload, planMode, threadId optional.
    const shape = t!.inputSchema as Record<string, { isOptional(): boolean; options?: string[] }>;
    expect(Object.keys(shape).sort()).toEqual(['contextType', 'message', 'payload', 'planMode', 'threadId']);
    const required = Object.keys(shape).filter((k) => !shape[k]!.isOptional()).sort();
    expect(required).toEqual(['contextType', 'message']);
    expect([...(shape.contextType!.options ?? [])].sort()).toEqual(['brief', 'chat', 'patch']);
    // The entity declares no hints (readOnly/destructive/idempotent/openWorld all null).
    expect(t!.annotations).toBeUndefined();

    // Returns { threadId, summary } — only the summary of the child re-enters.
    const res = (await t!.handler({ contextType: 'chat', message: 'go' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0]!.text)).toEqual({ threadId: 'c', summary: 's' });

    // Logic: "tool only in a top-level 'chat' thread" — the registry mounts the
    // server for `chat` alone; `patch` lost it in 2.1.18, `brief`/`ask` never had it.
    expect(CONTEXT_TYPE_REGISTRY.chat.mcp.transagentTools).toBe(true);
    for (const ct of ['patch', 'brief', 'ask'] as const) {
      expect(CONTEXT_TYPE_REGISTRY[ct].mcp.transagentTools, ct).toBe(false);
    }
    // Declared, not derived: `patch` admits the `turn` class and still does not mount it.
    expect(PROFILES.patch.operationClasses.has('turn')).toBe(true);
    expect(PROFILES.patch.transagentTools).toBe(false);
  });
});

/**
 * 2.1.18 (M46 `9w7zk9as`, `katalog-operacji-m46`) — the relaxed concurrency rule:
 * at most one banka in flight AT A TIME (no longer one per parent turn), further
 * calls in the same turn allowed once the previous one has returned, and the
 * artifact address of a fresh banka taken from `payload`. Exercised through the
 * real tool handler over a REAL dispatcher (one per parent turn, as agent-turn.ts
 * builds it) on a migrated in-memory schema; only the child turn is a stub whose
 * end the test controls.
 */
describe('runTransagent — one banka in flight at a time, a series in one turn (2.1.18)', () => {
  let db: Database.Database;
  let chat: ChatService;
  let parentThreadId: string;
  /** Child turns started and not yet finished — their resolvers, in start order. */
  let running: Array<{ threadId: string; finish: () => void }>;
  /** Highest number of child turns observed running side by side. */
  let maxConcurrent: number;
  let toolUseSeq: number;

  const childRows = () =>
    db
      .prepare(
        `SELECT id, context_type, patch_path, plan_path, brief_path, spawned_by_tool_use_id
           FROM chat_thread WHERE parent_thread_id = ? ORDER BY rowid`,
      )
      .all(parentThreadId) as Array<{
      id: string;
      context_type: string;
      patch_path: string | null;
      plan_path: string | null;
      brief_path: string | null;
      spawned_by_tool_use_id: string;
    }>;

  /** One parent turn: one dispatcher, one transagent-tools server. */
  const parentTurn = () => {
    const briefService = {
      createBrief: async () => ({ briefPath: `briefs/0-0-1-to-next-${toolUseSeq}.md` }),
      createThreadForBrief: (opts: { path: string; parentThreadId?: string | null; spawnedByToolUseId?: string | null }) => ({
        threadId: chat.createThread(`Brief edit: ${opts.path}`, {
          contextType: 'brief',
          briefPath: opts.path,
          parentThreadId: opts.parentThreadId ?? null,
          spawnedByToolUseId: opts.spawnedByToolUseId ?? null,
        }).id,
      }),
    };
    const planService = { assertPlanExists: async () => undefined };
    const deps = { chatService: chat, briefService, planService, activeAdapters: new Map() } as unknown as AgentTurnDeps;
    const dispatcher = new TransagentDispatcher(deps, {
      model: 'claude-opus-5' as never,
      architectureConfig: {},
      takeToolUseId: async () => `tu_${++toolUseSeq}`,
      runTurn: (input: AgentTurnInput) =>
        new Promise((resolve) => {
          running.push({ threadId: input.thread.id, finish: () => resolve({ answer: `done ${input.thread.id}` } as never) });
          maxConcurrent = Math.max(maxConcurrent, running.length);
        }).finally(() => {
          running = running.filter((r) => r.threadId !== input.thread.id);
        }) as never,
    });
    const server = buildTransagentToolsServer({ parentThreadId, dispatcher });
    const t = server.tools.find((x) => x.name === 'runTransagent');
    if (!t) throw new Error('runTransagent not registered');
    return (input: Record<string, unknown>) =>
      t.handler(input) as Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
  };

  /** Lets every pending microtask / timer-free await settle. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  /** Finishes the one child turn in flight, asserting there is exactly one. */
  const finishTheOneInFlight = async () => {
    await settle();
    expect(running).toHaveLength(1);
    running[0]!.finish();
    await settle();
  };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
    parentThreadId = chat.createThread('orchestrator', { contextType: 'chat' }).id;
    running = [];
    maxConcurrent = 0;
    toolUseSeq = 0;
  });

  afterEach(() => db.close());

  it('[ac:ac-maksymalnie-jedna-banka-transagenta-j] never runs two bubbles side by side: a second call issued while one is in flight founds nothing until the first returns', async () => {
    const call = parentTurn();
    // Two tool_use(runTransagent) issued together — the parallel case the
    // invariant forbids.
    const first = call({ contextType: 'patch', message: 'apply 1', payload: { patchPath: 'patches/p-1.md' } });
    const second = call({ contextType: 'patch', message: 'apply 2', payload: { patchPath: 'patches/p-2.md' } });

    await settle();
    // Only the first banka exists and runs; the second has founded no row yet.
    expect(running).toHaveLength(1);
    expect(childRows().map((r) => r.patch_path)).toEqual(['patches/p-1.md']);

    await finishTheOneInFlight(); // the first returns → the second starts
    expect((await first).isError).toBeFalsy();
    expect(childRows().map((r) => r.patch_path)).toEqual(['patches/p-1.md', 'patches/p-2.md']);

    await finishTheOneInFlight();
    expect((await second).isError).toBeFalsy();
    // At no point were two child turns in flight at once.
    expect(maxConcurrent).toBe(1);
  });

  it('[entity:katalog-operacji-m46#spawn_child_turn] declares spawn_child_turn internal-only with its error codes, takes the artifact address from payload, and lets one turn run a series of bubbles one after another', async () => {
    // Catalog row: internal = direct, cli / mcp / rest = n/a; the declared error codes.
    registerCoreOperations();
    const row = CATALOG.require('spawn_child_turn');
    expect(row.channels.internal.kind).toBe('direct');
    expect([row.channels.cli.kind, row.channels.mcp.kind, row.channels.rest.kind]).toEqual(['na', 'na', 'na']);
    expect(row.mediation).toBe('agent-mediated');
    expect(row.scope).toBe('project');
    expect(row.idempotent).toBe(false);
    expect(row.sideEffects).toEqual(['file', 'db', 'ui-notify']);
    expect(row.errorCodes).toEqual(
      expect.arrayContaining([
        'AGENT_ERROR',
        'TIMEOUT',
        'ABORTED',
        'INVALID_ARGS',
        'NOT_FOUND',
        'STREAM_IN_PROGRESS',
        'RESUME_CONFIG_LOCKED',
      ]),
    );
    // Multiplicity: at most one in flight; sequential calls in one turn allowed.
    expect(row.summary).toMatch(/At most one child in flight at a time; sequential calls in one parent turn are allowed/);

    // A series in ONE parent turn: each call awaited before the next.
    const call = parentTurn();
    const results: Array<{ threadId: string; summary: string }> = [];
    const series: Array<Record<string, unknown>> = [
      { contextType: 'patch', message: 'apply p-1', payload: { patchPath: 'patches/p-1.md' } },
      { contextType: 'patch', message: 'apply p-2', payload: { patchPath: 'patches/p-2.md' } },
      { contextType: 'chat', message: 'continue plan', payload: { planPath: 'plans/a.md' } },
      { contextType: 'chat', message: 'new plan' },
      { contextType: 'brief', message: 'findings' },
    ];
    for (const input of series) {
      const pending = call(input);
      await finishTheOneInFlight();
      const res = await pending;
      expect(res.isError, String(input.message)).toBeFalsy();
      results.push(JSON.parse(res.content[0]!.text) as { threadId: string; summary: string });
    }
    expect(maxConcurrent).toBe(1);

    // Every call of the series founded its own row, each with its own tool_use id.
    const rows = childRows();
    expect(rows.map((r) => r.id)).toEqual(results.map((r) => r.threadId));
    expect(new Set(rows.map((r) => r.spawned_by_tool_use_id)).size).toBe(series.length);

    // Addressing: the artifact address comes from `payload` — patchPath for patch,
    // planPath (optional; without it no plan is bound) for chat, a new brief for brief.
    expect(rows.map((r) => [r.context_type, r.patch_path ?? r.plan_path ?? r.brief_path])).toEqual([
      ['patch', 'patches/p-1.md'],
      ['patch', 'patches/p-2.md'],
      ['chat', 'plans/a.md'],
      ['chat', null],
      ['brief', 'briefs/0-0-1-to-next-5.md'],
    ]);

    // A fresh patch banka without its address is refused before any row exists.
    const before = childRows().length;
    const refused = await call({ contextType: 'patch', message: 'no address' });
    expect(refused.isError).toBe(true);
    expect((JSON.parse(refused.content[0]!.text) as { code: string }).code).toBe('INVALID_ARGS');
    expect(childRows()).toHaveLength(before);
  });

  it('[entity:transagent-tools-runtransagent] states the relaxed rule in the description the model reads: one in flight at a time, further calls in the same turn allowed', () => {
    const dispatcher = { run: async () => ({ threadId: 'c', summary: '' }) } as unknown as TransagentDispatcher;
    const text =
      buildTransagentToolsServer({ parentThreadId: 'parent_1', dispatcher }).tools.find((x) => x.name === 'runTransagent')
        ?.description ?? '';
    expect(text).toMatch(/Only one banka is in flight at a time/);
    expect(text).toMatch(/further calls in the same turn are allowed once the previous one has returned/);
    expect(text).not.toMatch(/per turn/);
  });
});
