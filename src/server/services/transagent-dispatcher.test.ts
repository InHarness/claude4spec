import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from './chat.js';
import { TransagentDispatcher, type TransagentRunInput } from './transagent-dispatcher.js';
import type { AgentTurnDeps, AgentTurnInput } from '../routes/agent-turn.js';
import { DomainError } from './tags.js';

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

  it('[ac:ac-kontynuacja-banki-przez-runtransagent] ignores planMode when continuing an existing banka — posture is set once, at creation', async () => {
    const parentThreadId = seedParent(false);
    const { threadId } = await run({ parentThreadId });
    expect(planModeOf(threadId)).toBe(0);

    // Continuation skips prepare-per-context, hence the generic step too: no
    // UPDATE chat_thread SET plan_mode may run on this path.
    await run({ parentThreadId, threadId, planMode: true });

    expect(planModeOf(threadId)).toBe(0);
    expect(turnThreads[1]?.planMode).toBe(false);
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
