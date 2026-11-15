import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTransagentToolsServer } from './transagent-tools.js';
import { TransagentDispatcher, admittedTransagentContextTypes, type TransagentRunInput } from '../services/transagent-dispatcher.js';
import { DomainError } from '../services/tags.js';
import type { AgentTurnDeps, AgentTurnInput } from '../routes/agent-turn.js';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from '../services/chat.js';
import { contextTypesFor } from '../services/chat-context.js';
import { SKILL_PROJECT_TYPE, SPEC_PROJECT_TYPE } from '../project-types/entries.js';

/**
 * 2.1.77 (M46 `qq84x14h`) — `transagent-tools` in a project without the
 * capability `briefs` (a Skill). The server and the dispatcher are wired the way
 * a turn of such a project wires them: `hasBriefs` (the server's composition,
 * the one capability read M46 keeps) and `contextTypes` (the project's context
 * type registry) read from the type entry's capability set, the services handed
 * in as the turn handler always does.
 *
 * 2.1.88 (M46 `exchr4q9`): the dispatcher's value set is no longer a capability
 * read. It admits the intersection of its closed branch set and the project
 * registry; a `brief`/`patch` call in a Skill is refused because the registry
 * has no such row (their rows require `briefs`), in the same validation step as a
 * value outside the closed set.
 */
const skillCaps = new Set(SKILL_PROJECT_TYPE.capabilities);
const specCaps = new Set(SPEC_PROJECT_TYPE.capabilities);

describe('transagent-tools in a `skill` project (2.1.77)', () => {
  let db: Database.Database;
  let chat: ChatService;
  let parentThreadId: string;
  let briefFilesCreated: number;
  let childTurns: number;

  const listService = { listPatches: () => [], listBriefs: () => [], listPlans: async () => [] };

  const serverFor = (caps: ReadonlySet<string>) => {
    const deps = {
      chatService: chat,
      briefService: {
        createBrief: async () => {
          briefFilesCreated += 1;
          return { briefPath: 'briefs/x.md' };
        },
        createThreadForBrief: () => ({ threadId: chat.createThread('b', { contextType: 'brief', briefPath: 'briefs/x.md' }).id }),
      },
      planService: { assertPlanExists: async () => undefined },
      activeAdapters: new Map(),
      contextTypes: contextTypesFor(caps),
    } as unknown as AgentTurnDeps;
    const dispatcher = new TransagentDispatcher(deps, {
      model: 'claude-opus-5' as never,
      architectureConfig: {},
      takeToolUseId: async () => 'tu_1',
      runTurn: async (_input: AgentTurnInput) => {
        childTurns += 1;
        return { answer: 'done' } as never;
      },
    });
    return buildTransagentToolsServer({
      parentThreadId,
      dispatcher,
      patches: listService as never,
      briefs: listService as never,
      plans: listService as never,
      projectId: 'p1',
      hasBriefs: caps.has('briefs'),
    });
  };

  const childRows = () =>
    db.prepare('SELECT id FROM chat_thread WHERE parent_thread_id = ?').all(parentThreadId) as Array<{ id: string }>;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
    parentThreadId = chat.createThread('orchestrator', { contextType: 'chat' }).id;
    briefFilesCreated = 0;
    childTurns = 0;
  });

  afterEach(() => db.close());

  it('[ac:ac-w-projekcie-typu-skill-serwer-transag] in a `skill` project the `transagent-tools` server does not expose the brief list', () => {
    const names = serverFor(skillCaps).tools.map((t) => t.name);
    expect(names).not.toContain('list_briefs');
    // M46 `qq84x14h`: `runTransagent` and `list_plans`, no `list_patches` either.
    expect(names).toEqual(['runTransagent', 'list_plans']);
    // Control: with `briefs` the three set lists are there.
    expect(serverFor(specCaps).tools.map((t) => t.name)).toEqual([
      'runTransagent',
      'list_patches',
      'list_briefs',
      'list_plans',
    ]);
  });

  it('[ac:ac-w-projekcie-typu-skill-wywolanie-runt] in a `skill` project `runTransagent` with `contextType: "brief"` is refused with INVALID_ARGS', async () => {
    const tool = serverFor(skillCaps).tools.find((t) => t.name === 'runTransagent')!;
    const result = (await tool.handler({ contextType: 'brief', message: 'write it up', planMode: false }, {} as never)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect((JSON.parse(result.content[0]!.text) as { code: string }).code).toBe('INVALID_ARGS');
    // Refused before anything is founded: no brief file, no child row, no child turn.
    expect(briefFilesCreated).toBe(0);
    expect(childRows()).toEqual([]);
    expect(childTurns).toBe(0);

    // `patch` is refused the same way, even with its required payload.
    const patch = (await tool.handler({
      contextType: 'patch',
      message: 'apply',
      payload: { patchPath: 'patches/p.md' },
      planMode: false,
    }, {} as never)) as { isError?: boolean; content: Array<{ text: string }> };
    expect((JSON.parse(patch.content[0]!.text) as { code: string }).code).toBe('INVALID_ARGS');
    expect(childRows()).toEqual([]);
  });

  it('M46 `exchr4q9`: `chat` stays available in a `skill` project; a `spec` project still founds a brief banka', async () => {
    const skillTool = serverFor(skillCaps).tools.find((t) => t.name === 'runTransagent')!;
    const ok = (await skillTool.handler({ contextType: 'chat', message: 'go', planMode: false }, {} as never)) as { isError?: boolean };
    expect(ok.isError).toBeFalsy();
    expect(childRows()).toHaveLength(1);

    const specTool = serverFor(specCaps).tools.find((t) => t.name === 'runTransagent')!;
    const brief = (await specTool.handler({ contextType: 'brief', message: 'write it up', planMode: false }, {} as never)) as {
      isError?: boolean;
    };
    expect(brief.isError).toBeFalsy();
    expect(briefFilesCreated).toBe(1);
  });
  /**
   * 2.1.88 — the record's `zachowanie`: a value outside the closed branch set, or
   * of that set but absent from the project registry, is INVALID_ARGS before
   * anything is founded. Driven through the dispatcher (the tool's zod enum
   * already stops an out-of-set value at the MCP boundary), so the dispatcher's
   * own step is what is observed.
   */
  it('[entity:spawn-child-turn] refuses a contextType outside the closed branch set, or of the set but not in the project registry, before founding anything', async () => {
    const dispatcherFor = (registry: readonly string[] | undefined) =>
      new TransagentDispatcher(
        {
          chatService: chat,
          briefService: {
            createBrief: async () => {
              briefFilesCreated += 1;
              return { briefPath: 'briefs/x.md' };
            },
          },
          planService: { assertPlanExists: async () => undefined },
          activeAdapters: new Map(),
          contextTypes: registry,
        } as unknown as AgentTurnDeps,
        {
          model: 'claude-opus-5' as never,
          architectureConfig: {},
          takeToolUseId: async () => 'tu_1',
          runTurn: async () => {
            childTurns += 1;
            return { answer: 'done' } as never;
          },
        },
      );
    const refusal = async (registry: readonly string[] | undefined, contextType: string) => {
      try {
        await dispatcherFor(registry).run({
          parentThreadId,
          contextType,
          message: 'go',
          payload: { patchPath: 'patches/p.md' },
        } as unknown as TransagentRunInput);
      } catch (err) {
        return err as DomainError;
      }
      return null;
    };

    // The admitted set is the closed set ∩ the project registry.
    expect(admittedTransagentContextTypes(contextTypesFor(specCaps))).toEqual(['brief', 'chat', 'patch']);
    expect(admittedTransagentContextTypes(contextTypesFor(skillCaps))).toEqual(['chat']);
    expect(admittedTransagentContextTypes(undefined)).toEqual(['brief', 'chat', 'patch']);

    // A registry value outside the closed set (`ask`, present in a spec project's
    // registry) — refused, not routed into a default branch.
    expect(contextTypesFor(specCaps)).toContain('ask');
    expect((await refusal(contextTypesFor(specCaps), 'ask'))?.code).toBe('VALIDATION');
    // A value nobody declared — refused the same way.
    expect((await refusal(undefined, 'future_value'))?.code).toBe('VALIDATION');
    // A value of the set the project registry lacks — the same step.
    const lacking = await refusal(contextTypesFor(skillCaps), 'patch');
    expect(lacking?.code).toBe('VALIDATION');
    expect(lacking?.message).toContain('expected one of chat');

    // Nothing founded by any of them.
    expect(briefFilesCreated).toBe(0);
    expect(childRows()).toEqual([]);
    expect(childTurns).toBe(0);
  });
});
