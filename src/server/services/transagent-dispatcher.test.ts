import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from './chat.js';
import { TransagentDispatcher, type TransagentRunInput } from './transagent-dispatcher.js';
import type { AgentTurnDeps, AgentTurnInput } from '../routes/agent-turn.js';
import { DomainError } from './tags.js';
import { AgentTurnError } from '../../shared/agent-turn.js';

/**
 * 0.2.30 M05: `runTransagent`'s `planMode` — the generic step of the dispatcher.
 *
 * Everything here reads the `chat_thread` row the dispatcher created, on a real
 * migrated schema: `plan_mode` is what the turn later reads (agent-turn resolves
 * `thread.planMode` → `disallowedToolGroups: ['file-write','shell']` + the
 * PLAN MODE ACTIVE prompt section), so the column IS
 * the posture. The child turn itself is a stub — it records the thread it was
 * handed so the same assertion can be made on what the turn would receive.
 */
describe('TransagentDispatcher — planMode (0.2.30)', () => {
  let db: Database.Database;
  let chat: ChatService;
  /** Threads passed to the (stubbed) child turn, in call order. */
  let turnThreads: AgentTurnInput['thread'][];

  const planModeOf = (threadId: string): number =>
    (db.prepare(`SELECT plan_mode FROM chat_thread WHERE id = ?`).get(threadId) as {
      plan_mode: number;
    }).plan_mode;

  /** Parent thread the dispatcher spawns from; `planMode` is the PARENT's posture. */
  const seedParent = (planMode: boolean): string => {
    const parent = chat.createThread('parent', { contextType: 'chat', planMode });
    return parent.id;
  };

  const makeDispatcher = (): TransagentDispatcher => {
    // The brief branch goes through BriefService; only the two calls the
    // dispatcher makes are stubbed, and `createThreadForBrief` forwards to the
    // REAL ChatService so the row under assertion is the row that ships.
    const briefService = {
      createBrief: async () => ({ briefPath: 'briefs/0-0-1-to-next.md' }),
      createThreadForBrief: (opts: {
        path: string;
        parentThreadId?: string | null;
        spawnedByToolUseId?: string | null;
        planMode?: boolean;
      }) => {
        const thread = chat.createThread(`Brief edit: ${opts.path}`, {
          contextType: 'brief',
          briefPath: opts.path,
          parentThreadId: opts.parentThreadId ?? null,
          spawnedByToolUseId: opts.spawnedByToolUseId ?? null,
          planMode: opts.planMode ?? false,
        });
        return { threadId: thread.id };
      },
    };
    const deps = {
      chatService: chat,
      briefService,
      activeAdapters: new Map(),
    } as unknown as AgentTurnDeps;

    return new TransagentDispatcher(deps, {
      model: 'claude-opus-5' as never,
      architectureConfig: {},
      takeToolUseId: async () => 'tu_1',
      runTurn: async (input: AgentTurnInput) => {
        turnThreads.push(input.thread);
        return { answer: 'done' } as never;
      },
    });
  };

  const run = (input: Partial<TransagentRunInput> & { parentThreadId: string }) =>
    makeDispatcher().run({
      contextType: 'chat',
      message: 'do the thing',
      ...input,
    } as TransagentRunInput);

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
    turnThreads = [];
  });

  afterEach(() => db.close());

  it('[ac:ac-runtransagent-planmode-true-ustawia-c] sets plan_mode on the child it creates, so the banka turn runs read-only', async () => {
    const parentThreadId = seedParent(false);

    const { threadId } = await run({ parentThreadId, planMode: true });

    // The column IS the posture: agent-turn reads `thread.planMode` and hands
    // the adapter the 'file-write' + 'shell' deny-groups, and
    // chat-context appends the PLAN MODE ACTIVE section off the same flag.
    expect(planModeOf(threadId)).toBe(1);
    expect(turnThreads[0]?.planMode).toBe(true);
  });

  it('[ac:ac-pominiety-planmode-w-wywolaniu-runtra] does NOT inherit the parent posture — an omitted planMode is false even under a plan-mode parent', async () => {
    // Same as the UI: clicking "new thread" from inside a plan-mode thread gives
    // a thread with the toggle OFF. A caller who wants inheritance passes it.
    const parentThreadId = seedParent(true);

    const { threadId } = await run({ parentThreadId });

    expect(planModeOf(parentThreadId)).toBe(1);
    expect(planModeOf(threadId)).toBe(0);
    expect(turnThreads[0]?.planMode).toBe(false);
  });

  it('[ac:ac-planmode-jest-polem-top-level-inputu] reads planMode from the top level only — a payload key of the same name is not the posture', async () => {
    // top-level = generic for the thread, `payload` = specific to the context
    // type. `plan_mode` is a plain chat_thread column shared by every context
    // type, so it never travels in the per-context payload.
    const parentThreadId = seedParent(false);

    const { threadId } = await run({
      parentThreadId,
      payload: { planMode: true } as Record<string, unknown>,
    });

    expect(planModeOf(threadId)).toBe(0);
  });

  it('[ac:ac-dispatcher-runtransagent-ustawia-plan] applies planMode identically for brief, chat and patch — one generic step, not three branch rules', async () => {
    const parentThreadId = seedParent(false);

    for (const contextType of ['brief', 'chat', 'patch'] as const) {
      const { threadId } = await run({
        parentThreadId,
        contextType,
        planMode: true,
        payload: contextType === 'patch' ? { patchPath: 'patches/p.md' } : undefined,
      });
      const row = db
        .prepare(`SELECT context_type, parent_thread_id, spawned_by_tool_use_id, plan_mode
                    FROM chat_thread WHERE id = ?`)
        .get(threadId) as {
        context_type: string;
        parent_thread_id: string;
        spawned_by_tool_use_id: string;
        plan_mode: number;
      };
      // The whole generic step, on every binding: the two columns that were
      // always generic plus the one this release added.
      expect(row).toMatchObject({
        context_type: contextType,
        parent_thread_id: parentThreadId,
        spawned_by_tool_use_id: 'tu_1',
        plan_mode: 1,
      });
    }
  });

  it("[ac:ac-banka-context-type-patch-spawnowana-z] keeps a patch banka spawned from a plan-mode parent unrestricted, so it can still edit the spec", async () => {
    // Inheritance here would be a concrete regression: the patch thread would
    // get the plan-mode deny-groups and lose Write/Edit/Bash — the only thing it exists
    // to do. (That a plan_mode=0 thread runs with the full builtin set is
    // covered at the turn level in agent-turn.test.ts.)
    const parentThreadId = seedParent(true);

    const { threadId } = await run({
      parentThreadId,
      contextType: 'patch',
      payload: { patchPath: 'patches/p.md' },
    });

    expect(planModeOf(threadId)).toBe(0);
    expect(turnThreads[0]?.planMode).toBe(false);
  });
});

/**
 * Brief 0-2-89-to-next M46: `runTransagent({ contextType: 'chat' })` binds the
 * child's `plan_path` from `payload.planPath`.
 *
 * Asserted on the `chat_thread` row of a real migrated schema, because the
 * column IS the attachment — everything downstream (the child's `update_plan`
 * upsert vs. compose, `getByThread`, the plan chip) reads it from there. The
 * dangling-path case additionally asserts the thread COUNT, which is the part
 * that cannot be seen from the returned value: a refusal must leave no orphan
 * child behind.
 */
describe('TransagentDispatcher — chat payload.planPath (M46)', () => {
  const EXISTING_PLAN = 'plans/ship-it.md';

  let db: Database.Database;
  let chat: ChatService;
  let turnThreads: AgentTurnInput['thread'][];
  /** Paths the shared existence gate was asked about, in call order. */
  let checkedPaths: string[];

  const planPathOf = (threadId: string): string | null =>
    (db.prepare(`SELECT plan_path FROM chat_thread WHERE id = ?`).get(threadId) as {
      plan_path: string | null;
    }).plan_path;

  const threadCount = (): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM chat_thread`).get() as { n: number }).n;

  const makeDispatcher = (): TransagentDispatcher => {
    // Stands in for PlanService.assertPlanExists — the ONE gate the dispatcher
    // shares with POST /api/plans/:planId/create-thread. It throws the loader's
    // own NOT_FOUND; translating that into VALIDATION is the dispatcher's job,
    // which is exactly what the dangling-path case below pins.
    const planService = {
      assertPlanExists: async (planPath: string) => {
        checkedPaths.push(planPath);
        if (planPath !== EXISTING_PLAN) {
          throw new DomainError('NOT_FOUND', `plan '${planPath}' not found`);
        }
      },
    };
    const deps = {
      chatService: chat,
      planService,
      activeAdapters: new Map(),
    } as unknown as AgentTurnDeps;

    return new TransagentDispatcher(deps, {
      model: 'claude-opus-5' as never,
      architectureConfig: {},
      takeToolUseId: async () => 'tu_1',
      runTurn: async (input: AgentTurnInput) => {
        turnThreads.push(input.thread);
        return { answer: 'done' } as never;
      },
    });
  };

  const run = (payload?: Record<string, unknown>) =>
    makeDispatcher().run({
      parentThreadId,
      contextType: 'chat',
      message: 'continue the plan',
      payload,
    } as TransagentRunInput);

  let parentThreadId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
    turnThreads = [];
    checkedPaths = [];
    parentThreadId = chat.createThread('parent', { contextType: 'chat' }).id;
  });

  afterEach(() => db.close());

  it('attaches the child to an existing plan named by payload.planPath', async () => {
    const { threadId } = await run({ planPath: EXISTING_PLAN });

    expect(planPathOf(threadId)).toBe(EXISTING_PLAN);
    // The turn is handed the already-attached row — the child never observes an
    // intermediate state without its plan, which is why the binding is at INSERT.
    expect(turnThreads[0]?.planPath).toBe(EXISTING_PLAN);
    expect(checkedPaths).toEqual([EXISTING_PLAN]);
  });

  it('refuses a planPath that names no plan with VALIDATION, creating no child thread', async () => {
    const before = threadCount();

    await expect(run({ planPath: 'plans/nope.md' })).rejects.toMatchObject({
      code: 'VALIDATION', // the MCP wrapper renames this to INVALID_ARGS
    });

    expect(threadCount()).toBe(before);
    expect(turnThreads).toEqual([]);
  });

  it('refuses a planPath that is present but not a string, rather than dropping it', async () => {
    // `payload` is z.record(z.string(), z.unknown()) at the tool boundary, so
    // nothing upstream rejects this shape. Silently ignoring it is the failure
    // this branch was written to remove.
    await expect(run({ planPath: 42 })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(threadCount()).toBe(1); // the parent only
  });

  it('leaves plan_path NULL when payload carries no planPath — the child creates its own plan', async () => {
    const { threadId } = await run();

    expect(planPathOf(threadId)).toBeNull();
    expect(checkedPaths).toEqual([]);
  });

  it('leaves plan_path NULL for an empty payload object too', async () => {
    const { threadId } = await run({});

    expect(planPathOf(threadId)).toBeNull();
  });
});

/**
 * 0.2.87 (M46): the parent-stream contract of a bubble — `transagent_completed`
 * carries the summary, and a question raised INSIDE the child renders in the
 * PARENT's panel and is answered by `requestId` through the parent's registry.
 */
describe('TransagentDispatcher — parent stream contract (0.2.87)', () => {
  let db: Database.Database;
  let chat: ChatService;
  let emitted: Array<Record<string, unknown>>;
  let pendingInputs: Map<string, { resolve: (r: unknown) => void; reject: (e: unknown) => void; requestIdsForRequest: string }>;
  let childInputs: AgentTurnInput[];

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
    emitted = [];
    pendingInputs = new Map();
    childInputs = [];
  });

  afterEach(() => db.close());

  const makeDispatcher = (
    parentThreadId: string,
    opts: { interactive: boolean; childTurn?: (input: AgentTurnInput) => Promise<unknown> },
  ): TransagentDispatcher => {
    const activeAdapters = new Map([
      [
        parentThreadId,
        { requestId: 'parent-req', emit: (e: Record<string, unknown>) => emitted.push(e) },
      ],
    ]);
    const deps = { chatService: chat, activeAdapters, pendingInputs } as unknown as AgentTurnDeps;
    return new TransagentDispatcher(deps, {
      model: 'claude-opus-5' as never,
      architectureConfig: {},
      takeToolUseId: async () => 'tu_parent',
      interactive: opts.interactive,
      runTurn: async (input: AgentTurnInput) => {
        childInputs.push(input);
        if (opts.childTurn) await opts.childTurn(input);
        return { answer: 'child summary' } as never;
      },
    });
  };

  it('transagent_completed carries the summary returned to the parent', async () => {
    const parent = chat.createThread('parent');
    await makeDispatcher(parent.id, { interactive: true }).run({
      parentThreadId: parent.id,
      contextType: 'chat',
      message: 'go',
    });

    const completed = emitted.find((e) => e.type === 'transagent_completed');
    expect(completed).toMatchObject({ toolUseId: 'tu_parent', status: 'completed', summary: 'child summary' });
  });

  it('relays a child user_input_request to the parent stream, persists it on the parent, and resolves by requestId', async () => {
    const parent = chat.createThread('parent');
    let answer: unknown;
    const dispatcher = makeDispatcher(parent.id, {
      interactive: true,
      childTurn: async (input) => {
        const pending = input.onUserInput!({ requestId: 'q1', questions: [] } as never);
        // The parent's POST /api/chat/user-input does exactly this.
        const entry = pendingInputs.get('q1')!;
        expect(entry.requestIdsForRequest).toBe('parent-req');
        entry.resolve({ action: 'accept', answers: {} });
        answer = await pending;
      },
    });

    await dispatcher.run({ parentThreadId: parent.id, contextType: 'chat', message: 'go' });

    expect(emitted.some((e) => e.type === 'user_input_request')).toBe(true);
    const parentRows = chat.getMessages(parent.id).map((m) => m.role);
    expect(parentRows).toContain('user_input_request');
    expect(answer).toEqual({ action: 'accept', answers: {} });
  });

  it('a child that ends with a question unanswered cancels it on the parent (no dead card)', async () => {
    const parent = chat.createThread('parent');
    let rejection: unknown;
    const dispatcher = makeDispatcher(parent.id, {
      interactive: true,
      childTurn: async (input) => {
        // Child raises a question, then ends (timeout / error / own abort) without an answer.
        input.onUserInput!({ requestId: 'q-orphan', questions: [] } as never).catch((e) => {
          rejection = e;
        });
        throw new Error('child timed out');
      },
    });

    await expect(
      dispatcher.run({ parentThreadId: parent.id, contextType: 'chat', message: 'go' }),
    ).rejects.toThrow('child timed out');
    await Promise.resolve();

    expect(pendingInputs.has('q-orphan')).toBe(false);
    expect(rejection).toBeInstanceOf(Error);
  });

  it('a headless parent gives the child no user-input handler', async () => {
    const parent = chat.createThread('parent');
    await makeDispatcher(parent.id, { interactive: false }).run({
      parentThreadId: parent.id,
      contextType: 'chat',
      message: 'go',
    });

    expect(childInputs[0]?.onUserInput).toBeUndefined();
  });

  it('listChildThreads resolves children from parent_thread_id + spawned_by_tool_use_id', async () => {
    const parent = chat.createThread('parent');
    const { threadId } = await makeDispatcher(parent.id, { interactive: false }).run({
      parentThreadId: parent.id,
      contextType: 'chat',
      message: 'go',
    });

    expect(chat.listChildThreads(parent.id)).toEqual([
      { id: threadId, spawnedByToolUseId: 'tu_parent', contextType: 'chat' },
    ]);
  });
});

describe('ChatService — child column invariant (0.2.87)', () => {
  it('rejects a row with only one of parent_thread_id / spawned_by_tool_use_id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const chat = new ChatService(db);
    const parent = chat.createThread('parent');

    expect(() => chat.createThread('orphan', { spawnedByToolUseId: 'tu_x' })).toThrow(DomainError);
    expect(() => chat.createThread('unlinked', { parentThreadId: parent.id })).toThrow(DomainError);
    expect(chat.createThread('child', { parentThreadId: parent.id, spawnedByToolUseId: 'tu_y' }).parentThreadId).toBe(
      parent.id,
    );
    db.close();
  });
});

/**
 * 0.2.90 M46: `payload.patchPath` is REQUIRED on the `patch` branch — and only
 * there. The refusal comes before any child exists, in the same validation step
 * as an out-of-set value, because a child with an empty patch_path would break
 * `context_type='patch' ⇒ patch_path IS NOT NULL`.
 */
describe('TransagentDispatcher — patch payload.patchPath + brief payload (0.2.90)', () => {
  let db: Database.Database;
  let chat: ChatService;
  let parentThreadId: string;
  let createBriefCalls: unknown[];

  const childCount = (): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM chat_thread WHERE parent_thread_id IS NOT NULL`).get() as {
      n: number;
    }).n;

  const run = (contextType: TransagentRunInput['contextType'], payload?: Record<string, unknown>) => {
    const briefService = {
      createBrief: async (opts: unknown) => {
        createBriefCalls.push(opts);
        return { briefPath: 'briefs/0-0-1-to-next.md' };
      },
      createThreadForBrief: (opts: {
        path: string;
        parentThreadId?: string | null;
        spawnedByToolUseId?: string | null;
      }) => ({
        threadId: chat.createThread(`Brief edit: ${opts.path}`, {
          contextType: 'brief',
          briefPath: opts.path,
          parentThreadId: opts.parentThreadId ?? null,
          spawnedByToolUseId: opts.spawnedByToolUseId ?? null,
        }).id,
      }),
    };
    const deps = { chatService: chat, briefService, activeAdapters: new Map() } as unknown as AgentTurnDeps;
    return new TransagentDispatcher(deps, {
      model: 'claude-opus-5' as never,
      architectureConfig: {},
      takeToolUseId: async () => 'tu_1',
      runTurn: async () => ({ answer: 'done' }) as never,
    }).run({ parentThreadId, contextType, message: 'go', payload } as TransagentRunInput);
  };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
    createBriefCalls = [];
    parentThreadId = chat.createThread('parent', { contextType: 'chat' }).id;
  });

  afterEach(() => db.close());

  it.each([
    ['no payload', undefined],
    ['a payload without patchPath', { suffix: 'x' }],
    ['an empty patchPath', { patchPath: '' }],
    ['a non-string patchPath', { patchPath: 7 }],
  ])(
    "refuses contextType='patch' with %s as VALIDATION (INVALID_ARGS at the tool) — no child chat_thread is created",
    async (_label, payload) => {
      await expect(run('patch', payload)).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(childCount()).toBe(0);
    },
  );

  it("creates the patch child bound to payload.patchPath when it is given", async () => {
    const { threadId } = await run('patch', { patchPath: 'patches/p-1.md' });
    const row = db.prepare(`SELECT context_type, patch_path, parent_thread_id FROM chat_thread WHERE id = ?`).get(
      threadId,
    ) as { context_type: string; patch_path: string; parent_thread_id: string };
    expect(row).toEqual({ context_type: 'patch', patch_path: 'patches/p-1.md', parent_thread_id: parentThreadId });
  });

  it('passes payload.content and payload.suffix straight into createBrief, with to = null', async () => {
    await run('brief', { content: '# Body\n\nanalysis', suffix: 'tail' });
    expect(createBriefCalls).toEqual([
      { fromReleaseName: undefined, toReleaseName: null, content: '# Body\n\nanalysis', suffix: 'tail' },
    ]);
  });
});

/**
 * 0.2.107 (M46): the child has its OWN idle clock — the library's, armed by its
 * own runAgentTurn because the dispatcher passes no `timeoutMs` (only `ask`
 * does, and `ask` runs without one). The parent needs nothing from the
 * dispatcher: its `runTransagent` tool_use is outstanding work to the library.
 * What is left here is that a child's idle stop comes back as an error.
 */
describe('TransagentDispatcher — idle clocks (0.2.107)', () => {
  let db: Database.Database;
  let chat: ChatService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
  });
  afterEach(() => db.close());

  const setup = (runTurn: (input: AgentTurnInput) => Promise<unknown>) => {
    const parent = chat.createThread('parent', { contextType: 'chat' });
    const parentEntry = {
      requestId: 'req_parent',
      emit: () => {},
      replay: { events: [] },
    };
    const deps = {
      chatService: chat,
      activeAdapters: new Map([[parent.id, parentEntry]]),
      pendingInputs: new Map(),
    } as unknown as AgentTurnDeps;
    const dispatcher = new TransagentDispatcher(deps, {
      model: 'claude-opus-5' as never,
      architectureConfig: {},
      takeToolUseId: async () => 'tu_1',
      runTurn: runTurn as never,
      interactive: true,
    });
    return { parentThreadId: parent.id, dispatcher };
  };

  it('runs the child with no `timeoutMs`, so its own turn arms the interactive idle clock', async () => {
    let childInput: AgentTurnInput | undefined;
    const { parentThreadId, dispatcher } = setup(async (input) => {
      childInput = input;
      return { answer: 'done' };
    });

    await dispatcher.run({ parentThreadId, contextType: 'chat', message: 'go' });

    expect(childInput).toBeDefined();
    expect(childInput!.timeoutMs).toBeUndefined();
  });

  it('[ac:ac-banka-milczaca-dluzej-niz-zegar-idle] lets a child idle stop propagate as IDLE_TIMEOUT', async () => {
    const { parentThreadId, dispatcher } = setup(async () => {
      throw new AgentTurnError('IDLE_TIMEOUT', 'Agent went idle for 60 min with nothing in flight — the turn was stopped');
    });

    await expect(
      dispatcher.run({ parentThreadId, contextType: 'chat', message: 'go' }),
    ).rejects.toMatchObject({ code: 'IDLE_TIMEOUT' });
  });
});

/**
 * 0.2.111 (M46): EVERY `runTransagent` call founds a new `chat_thread` row as a
 * child of the caller — a continuation too. The continuation row copies the
 * referenced banka's binding, plan mode, config snapshot and session, its turn
 * resumes that session, and the referenced row is never touched. Five checks run
 * before the INSERT, and a refusal founds no row.
 *
 * Asserted on the real migrated schema: the columns ARE the contract (the panel,
 * the abort cascade and the resume guard all read them from there).
 */
describe('TransagentDispatcher — continuation founds a new row (0.2.111)', () => {
  let db: Database.Database;
  let chat: ChatService;
  let cwd: string;
  let turnInputs: AgentTurnInput[];
  let emitted: Array<Record<string, unknown>>;
  let activeAdapters: Map<string, Record<string, unknown>>;
  let missingArtifacts: Set<string>;

  const SNAPSHOT = { model: 'claude-opus-5', architectureConfig: {} };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-transagent-'));
    turnInputs = [];
    emitted = [];
    activeAdapters = new Map();
    missingArtifacts = new Set();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const rowOf = (id: string): Record<string, unknown> =>
    db.prepare(`SELECT * FROM chat_thread WHERE id = ?`).get(id) as Record<string, unknown>;
  const threadCount = (): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM chat_thread`).get() as { n: number }).n;

  /** A top-level thread with a live parent adapter (so the bracketing events are captured). */
  const seedCaller = (): string => {
    const id = chat.createThread('caller', { contextType: 'chat' }).id;
    activeAdapters.set(id, { requestId: `req-${id}`, emit: (e: Record<string, unknown>) => emitted.push(e) });
    return id;
  };

  /** A banka that already ran a turn: session + config snapshot + system prompt recorded. */
  const seedBanka = (
    parentThreadId: string,
    opts: {
      contextType?: 'brief' | 'chat' | 'patch';
      planMode?: boolean;
      sessionId?: string;
      snapshot?: Record<string, unknown>;
      toolUseId?: string;
    } = {},
  ): string => {
    const contextType = opts.contextType ?? 'chat';
    const banka = chat.createThread('banka', {
      contextType,
      ...(contextType === 'brief' ? { briefPath: 'briefs/0-0-1-to-next.md' } : {}),
      ...(contextType === 'patch' ? { patchPath: 'patches/p.md' } : {}),
      ...(contextType === 'chat' ? { planPath: 'plans/p.md' } : {}),
      parentThreadId,
      spawnedByToolUseId: opts.toolUseId ?? 'tu_spawn',
      planMode: opts.planMode ?? false,
    });
    chat.setLastSessionId(banka.id, opts.sessionId ?? 'sess-1');
    chat.setInitialArchitectureConfig(banka.id, (opts.snapshot ?? SNAPSHOT) as never);
    chat.setInitialSystemPrompt(banka.id, 'the prompt the session was created with');
    return banka.id;
  };

  const makeDispatcher = (opts: { model?: string; toolUseId?: string } = {}): TransagentDispatcher => {
    const artifact = (kind: string) => async (p: string) => {
      if (missingArtifacts.has(p)) throw new DomainError('NOT_FOUND', `${kind} '${p}' not found`);
      return {};
    };
    const deps = {
      chatService: chat,
      briefService: { getBrief: artifact('brief') },
      patchService: { getPatch: artifact('patch') },
      activeAdapters,
      pendingInputs: new Map(),
      cwd,
      roots: [],
    } as unknown as AgentTurnDeps;
    return new TransagentDispatcher(deps, {
      model: (opts.model ?? 'claude-opus-5') as never,
      architectureConfig: {},
      takeToolUseId: async () => opts.toolUseId ?? 'tu_cont',
      runTurn: async (input: AgentTurnInput) => {
        turnInputs.push(input);
        return { answer: 'continued' } as never;
      },
    });
  };

  const cont = (
    parentThreadId: string,
    threadId: string,
    extra: Partial<TransagentRunInput> = {},
    dispatcherOpts: { model?: string; toolUseId?: string } = {},
  ) =>
    makeDispatcher(dispatcherOpts).run({
      parentThreadId,
      contextType: 'chat',
      message: 'keep going',
      threadId,
      ...extra,
    });

  it('[ac:ac-wywolanie-runtransagent-z-threadid-za] founds a new chat_thread row', async () => {
    const caller = seedCaller();
    const banka = seedBanka(caller);
    const before = threadCount();

    const { threadId } = await cont(caller, banka);

    expect(threadCount()).toBe(before + 1);
    expect(threadId).not.toBe(banka);
    expect(turnInputs[0]?.thread.id).toBe(threadId);
  });

  it('[ac:ac-threadid-zwrocony-przez-kontynuacje-j] returns the id of the new row, never the input id', async () => {
    const caller = seedCaller();
    const banka = seedBanka(caller);
    const result = await cont(caller, banka);
    expect(result).toEqual({ threadId: turnInputs[0]?.thread.id, summary: 'continued' });
    expect(result.threadId).not.toBe(banka);
  });

  it('[ac:ac-parent-thread-id-wiersza-kontynuacji] parents the new row on the CALLER, not on the banka\'s original parent', async () => {
    const origin = seedCaller();
    const banka = seedBanka(origin);
    const caller = seedCaller();

    const { threadId } = await cont(caller, banka);

    expect(rowOf(threadId).parent_thread_id).toBe(caller);
    expect(rowOf(banka).parent_thread_id).toBe(origin);
  });

  it('[ac:ac-spawned-by-tool-use-id-wiersza-kontyn] stamps the new row with THIS call\'s tool_use id', async () => {
    const caller = seedCaller();
    const banka = seedBanka(caller, { toolUseId: 'tu_first' });
    const { threadId } = await cont(caller, banka, {}, { toolUseId: 'tu_second' });
    expect(rowOf(threadId).spawned_by_tool_use_id).toBe('tu_second');
  });

  it('[ac:ac-wiersz-kontynuacji-ma-context-type-ws] [ac:ac-wiersz-kontynuacji-ma-sciezke-artefak] copies context_type and the artifact path, ignoring payload', async () => {
    const caller = seedCaller();
    const chatBanka = seedBanka(caller);
    const patchBanka = seedBanka(caller, { contextType: 'patch', sessionId: 'sess-p' });
    const briefBanka = seedBanka(caller, { contextType: 'brief', sessionId: 'sess-b' });

    const c = await cont(caller, chatBanka, { payload: { planPath: 'plans/other.md' } });
    const p = await cont(caller, patchBanka, { contextType: 'patch', payload: { patchPath: 'patches/other.md' } });
    const b = await cont(caller, briefBanka, { contextType: 'brief', payload: { fromReleaseName: 'x' } });

    expect(rowOf(c.threadId)).toMatchObject({ context_type: 'chat', plan_path: 'plans/p.md' });
    expect(rowOf(p.threadId)).toMatchObject({ context_type: 'patch', patch_path: 'patches/p.md' });
    expect(rowOf(b.threadId)).toMatchObject({ context_type: 'brief', brief_path: 'briefs/0-0-1-to-next.md' });
  });

  it('[ac:ac-kontynuacja-banki-przez-runtransagent] takes plan_mode from the banka regardless of the call\'s planMode', async () => {
    const caller = seedCaller();
    const planBanka = seedBanka(caller, { planMode: true, sessionId: 'sess-plan' });
    const freeBanka = seedBanka(caller, { planMode: false, sessionId: 'sess-free' });

    const a = await cont(caller, planBanka, { planMode: false });
    const b = await cont(caller, freeBanka, { planMode: true });

    expect(rowOf(a.threadId).plan_mode).toBe(1);
    expect(rowOf(b.threadId).plan_mode).toBe(0);
    expect(turnInputs.map((i) => i.thread.planMode)).toEqual([true, false]);
  });

  it('[ac:ac-wiersz-kontynuacji-ma-initial-archite] [ac:ac-wiersz-kontynuacji-ma-przy-zalozeniu] copies the config snapshot and last_session_id, so the turn resumes that session', async () => {
    const caller = seedCaller();
    const banka = seedBanka(caller, { sessionId: 'sess-42' });

    const { threadId } = await cont(caller, banka);

    const row = rowOf(threadId);
    expect(row.initial_architecture_config_json).toBe(rowOf(banka).initial_architecture_config_json);
    expect(row.last_session_id).toBe('sess-42');
    // The turn runner resumes from `thread.lastSessionId` (no fork).
    expect(turnInputs[0]?.thread.lastSessionId).toBe('sess-42');
  });

  it('[ac:ac-po-turze-kontynuacji-initial-system-p] founds the row without initial_system_prompt', async () => {
    const caller = seedCaller();
    const banka = seedBanka(caller);
    const { threadId } = await cont(caller, banka);
    expect(rowOf(threadId).initial_system_prompt).toBeNull();
  });

  it('[ac:ac-kontynuacja-nie-modyfikuje-wiersza-ws] leaves the referenced banka row untouched', async () => {
    const caller = seedCaller();
    const banka = seedBanka(caller);
    const before = rowOf(banka);

    await cont(caller, banka, { planMode: true, payload: { planPath: 'plans/other.md' } });

    expect(rowOf(banka)).toEqual(before);
  });

  it('[ac:ac-banke-zrodzona-w-innym-watku-top-leve] continues a banka born in another top-level thread', async () => {
    const otherTopLevel = seedCaller();
    const banka = seedBanka(otherTopLevel);
    const caller = seedCaller();

    const { threadId } = await cont(caller, banka);

    expect(chat.listChildThreads(caller).map((c) => c.id)).toEqual([threadId]);
    expect(chat.listChildThreads(otherTopLevel).map((c) => c.id)).toEqual([banka]);
  });

  it('brackets the turn with childThreadId = the NEW row', async () => {
    const caller = seedCaller();
    const banka = seedBanka(caller);
    const { threadId } = await cont(caller, banka);
    const brackets = emitted.filter((e) => String(e.type).startsWith('transagent_'));
    expect(brackets.map((e) => [e.type, e.childThreadId, e.toolUseId])).toEqual([
      ['transagent_started', threadId, 'tu_cont'],
      ['transagent_completed', threadId, 'tu_cont'],
    ]);
  });

  describe('refusals — each lands before the INSERT', () => {
    const expectRefusal = async (
      call: () => Promise<unknown>,
      code: string,
    ): Promise<void> => {
      const before = threadCount();
      await expect(call()).rejects.toMatchObject({ code });
      expect(threadCount()).toBe(before);
      expect(turnInputs).toHaveLength(0);
    };

    it('NOT_FOUND for an unknown threadId', async () => {
      const caller = seedCaller();
      await expectRefusal(() => cont(caller, 'nope'), 'NOT_FOUND');
    });

    it('[ac:ac-threadid-watku-top-level-konczy-sie-o] INVALID_ARGS (VALIDATION) for a top-level thread', async () => {
      const caller = seedCaller();
      const topLevel = seedCaller();
      chat.setLastSessionId(topLevel, 'sess-user');
      await expectRefusal(() => cont(caller, topLevel), 'VALIDATION');
    });

    it('[ac:ac-contexttype-niezgodny-z-typem-konteks] INVALID_ARGS (VALIDATION) when contextType differs from the banka\'s', async () => {
      const caller = seedCaller();
      const banka = seedBanka(caller, { contextType: 'patch' });
      await expectRefusal(() => cont(caller, banka, { contextType: 'chat' }), 'VALIDATION');
    });

    it('[ac:ac-kontynuacja-banki-ktorej-brief-albo-p] NOT_FOUND when the banka\'s brief or patch file is gone', async () => {
      const caller = seedCaller();
      const briefBanka = seedBanka(caller, { contextType: 'brief' });
      const patchBanka = seedBanka(caller, { contextType: 'patch', sessionId: 'sess-p' });
      missingArtifacts.add('briefs/0-0-1-to-next.md');
      missingArtifacts.add('patches/p.md');
      await expectRefusal(() => cont(caller, briefBanka, { contextType: 'brief' }), 'NOT_FOUND');
      await expectRefusal(() => cont(caller, patchBanka, { contextType: 'patch' }), 'NOT_FOUND');
    });

    it('lets a dangling plan_path through — a plan degrades gracefully', async () => {
      const caller = seedCaller();
      const banka = seedBanka(caller);
      missingArtifacts.add('plans/p.md');
      await expect(cont(caller, banka)).resolves.toMatchObject({ summary: 'continued' });
    });

    it('[ac:ac-kontynuacja-sesji-wznawianej-przez-wi] STREAM_IN_PROGRESS while the banka row itself is live', async () => {
      const caller = seedCaller();
      const banka = seedBanka(caller);
      activeAdapters.set(banka, { requestId: 'r-banka', sessionId: 'sess-1' });
      await expectRefusal(() => cont(caller, banka), 'STREAM_IN_PROGRESS');
    });

    it('[ac:ac-kontynuacja-sesji-wznawianej-przez-wi] STREAM_IN_PROGRESS while ANOTHER row is resuming the same session', async () => {
      const caller = seedCaller();
      const banka = seedBanka(caller, { sessionId: 'sess-shared' });
      activeAdapters.set('some-continuation-row', { requestId: 'r-x', sessionId: 'sess-shared' });
      await expectRefusal(() => cont(caller, banka), 'STREAM_IN_PROGRESS');
    });

    it('[ac:ac-kontynuacja-ze-zmienionym-polem-immut] RESUME_CONFIG_LOCKED when the turn config differs from the banka\'s snapshot (third guard entry point)', async () => {
      const caller = seedCaller();
      const banka = seedBanka(caller, { snapshot: { model: 'claude-sonnet-5', architectureConfig: {} } });
      const before = threadCount();

      const err = await cont(caller, banka).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(DomainError);
      expect(err).toMatchObject({ code: 'RESUME_CONFIG_LOCKED' });
      expect((err as DomainError).message).toContain('model');
      expect((err as DomainError).hint).toMatch(/omit `threadId`/);
      expect(threadCount()).toBe(before);
    });

    it('[ac:ac-odmowa-kontynuacji-nie-zaklada-wiersz] refuses in the documented order: contextType before artifact before stream before config', async () => {
      const caller = seedCaller();
      const banka = seedBanka(caller, {
        contextType: 'patch',
        snapshot: { model: 'claude-sonnet-5', architectureConfig: {} },
      });
      missingArtifacts.add('patches/p.md');
      activeAdapters.set(banka, { requestId: 'r-banka', sessionId: 'sess-1' });
      const before = threadCount();

      await expect(cont(caller, banka, { contextType: 'chat' })).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(cont(caller, banka, { contextType: 'patch' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      missingArtifacts.clear();
      await expect(cont(caller, banka, { contextType: 'patch' })).rejects.toMatchObject({
        code: 'STREAM_IN_PROGRESS',
      });
      activeAdapters.delete(banka);
      await expect(cont(caller, banka, { contextType: 'patch' })).rejects.toMatchObject({
        code: 'RESUME_CONFIG_LOCKED',
      });

      expect(threadCount()).toBe(before);
    });
  });
});
