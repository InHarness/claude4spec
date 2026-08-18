import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from './chat.js';
import { TransagentDispatcher, type TransagentRunInput } from './transagent-dispatcher.js';
import type { AgentTurnDeps, AgentTurnInput } from '../routes/agent-turn.js';

/**
 * 0.2.30 M05: `runTransagent`'s `planMode` — the generic step of the dispatcher.
 *
 * Everything here reads the `chat_thread` row the dispatcher created, on a real
 * migrated schema: `plan_mode` is what the turn later reads (agent-turn resolves
 * `thread.planMode` → `tools = READONLY_BUILTINS` + `disallowedTools =
 * MUTATING_BUILTINS` + the PLAN MODE ACTIVE prompt section), so the column IS
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
    // the adapter READONLY_BUILTINS + disallowedTools = MUTATING_BUILTINS, and
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
    // get READONLY_BUILTINS and lose Write/Edit/Bash — the only thing it exists
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
