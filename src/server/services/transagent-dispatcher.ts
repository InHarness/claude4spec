/**
 * 0.1.69 Transagents ("bańki") — TransagentDispatcher.
 *
 * A chat/patch thread delegates a unit of work to a hidden CHILD thread of the
 * same spec via the `runTransagent` MCP tool. The dispatcher:
 *   1. resolves or creates the child thread (binding per `contextType`),
 *   2. emits `transagent_started` into the PARENT's stream so the parent panel
 *      can nested-live-join the child,
 *   3. runs a full child turn through the shared `runAgentTurn`,
 *   4. emits `transagent_completed` and returns only `{ threadId, summary }` to
 *      the parent LLM's context (the child's full transcript stays hidden).
 *
 * Built per chat request in `agent-turn.ts` with the parent's `model` /
 * `architectureConfig` (so the child inherits credentials + model) and a
 * `runTurn` callback bound to the same `AgentTurnDeps` (injected to avoid a
 * value-level import cycle with agent-turn.ts).
 */

import { nanoid } from 'nanoid';
import type { ChatThread } from '../../shared/entities.js';
import type {
  AgentTurnDeps,
  AgentTurnInput,
  AgentTurnResult,
  Model,
} from '../routes/agent-turn.js';
import { DomainError } from './tags.js';

export interface TransagentRunInput {
  parentThreadId: string;
  contextType: 'brief' | 'chat' | 'patch';
  message: string;
  /** Per-contextType binding hints (e.g. `{ fromReleaseName, patchPath, suffix }`). */
  payload?: Record<string, unknown>;
  /** Continue an existing child banka instead of creating one. */
  threadId?: string;
}

export interface TransagentRunResult {
  threadId: string;
  summary: string;
}

export interface TransagentDispatcherOpts {
  /** Parent turn's model — the child inherits it. */
  model: Model;
  /** Parent turn's architectureConfig (carries custom_env / credentials). */
  architectureConfig: Record<string, unknown>;
  /**
   * Resolves the parent's `tool_use(runTransagent)` id (fed race-free by the
   * agent-turn loop). The created child stores it as `spawned_by_tool_use_id`,
   * and it is echoed on `transagent_started`/`_completed` so the parent panel
   * (and F5 reconstruction) can correlate the child with its tool_use block.
   */
  takeToolUseId: () => Promise<string>;
  /** Bound `(input) => runAgentTurn(deps, input)` — injected to avoid an import cycle. */
  runTurn: (input: AgentTurnInput) => Promise<AgentTurnResult>;
}

export class TransagentDispatcher {
  constructor(
    private deps: AgentTurnDeps,
    private opts: TransagentDispatcherOpts,
  ) {}

  async run(input: TransagentRunInput): Promise<TransagentRunResult> {
    const { parentThreadId, contextType, message } = input;
    const payload = input.payload ?? {};

    // The parent's tool_use id (race-free via the agent-turn loop). Used as the
    // child's spawned_by_tool_use_id and echoed on the bracketing events.
    const toolUseId = await this.opts.takeToolUseId();

    // 1. Resolve/create the child thread.
    let child: ChatThread;
    if (input.threadId) {
      const existing = this.deps.chatService.getThreadMeta(input.threadId);
      if (!existing) throw new DomainError('NOT_FOUND', `child thread '${input.threadId}' not found`);
      if (existing.parentThreadId !== parentThreadId) {
        throw new DomainError('VALIDATION', `thread '${input.threadId}' is not a child of this thread`);
      }
      child = existing;
    } else {
      child = await this.createChild(contextType, parentThreadId, toolUseId, message, payload);
    }

    const parentAdapter = this.deps.activeAdapters.get(parentThreadId);

    // 2. Bracket the child run with events on the PARENT's stream so the parent
    //    panel renders a nested child marker (and a joiner reconstructs it from
    //    the replay buffer — these types are in REPLAY_EVENT_TYPES).
    parentAdapter?.emit({
      type: 'transagent_started',
      childThreadId: child.id,
      toolUseId,
      contextType,
      timestamp: new Date().toISOString(),
    });

    try {
      // 3. Run the child turn. `onEvent` is a no-op — the child renders via its
      //    own stream entry (GET /api/chat/stream/:childThreadId), not the
      //    parent transport. runAgentTurn registers activeAdapters[child.id]
      //    (with parentThreadId from the row) so the parent can nested-join.
      const result = await this.opts.runTurn({
        thread: child,
        prompt: message,
        model: this.opts.model,
        architectureConfig: this.opts.architectureConfig,
        requestId: nanoid(12),
        consoleObserver: null,
        onEvent: () => {},
      });

      // 4. Completion — return only the summary to the parent LLM's context.
      parentAdapter?.emit({
        type: 'transagent_completed',
        childThreadId: child.id,
        toolUseId,
        status: 'completed',
        timestamp: new Date().toISOString(),
      });
      return { threadId: child.id, summary: result.answer };
    } catch (err) {
      // Child failure collapses upward as the parent's tool_result isError
      // (handled by the MCP wrapper). Still bracket-close the panel.
      parentAdapter?.emit({
        type: 'transagent_completed',
        childThreadId: child.id,
        toolUseId,
        status: 'error',
        timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  /**
   * Context-type registry: how to materialize a child thread per `contextType`.
   *   - brief → create an analysis brief file (source:'analysis', to_release:null,
   *     from=payload.fromReleaseName ?? latest) then a child brief thread.
   *   - patch → child patch thread (requires payload.patchPath).
   *   - chat  → plain child chat thread.
   */
  private async createChild(
    contextType: 'brief' | 'chat' | 'patch',
    parentThreadId: string,
    spawnedByToolUseId: string,
    message: string,
    payload: Record<string, unknown>,
  ): Promise<ChatThread> {
    if (contextType === 'brief') {
      const fromReleaseName =
        typeof payload.fromReleaseName === 'string'
          ? payload.fromReleaseName
          : (this.deps.releaseService.listReleases()[0]?.name ?? null);
      const suffix = typeof payload.suffix === 'string' ? payload.suffix : undefined;
      const content = typeof payload.content === 'string' ? payload.content : undefined;
      const { briefPath } = await this.deps.briefService.createBrief({
        source: 'analysis',
        fromReleaseName,
        toReleaseName: null,
        content,
        suffix,
      });
      const { threadId } = this.deps.briefService.createThreadForBrief({
        path: briefPath,
        parentThreadId,
        spawnedByToolUseId,
      });
      const child = this.deps.chatService.getThreadMeta(threadId);
      if (!child) throw new DomainError('INTERNAL', 'child brief thread disappeared after create');
      return child;
    }

    if (contextType === 'patch') {
      const patchPath = typeof payload.patchPath === 'string' ? payload.patchPath : null;
      if (!patchPath) {
        throw new DomainError('VALIDATION', "contextType='patch' requires payload.patchPath");
      }
      return this.deps.chatService.createThread(`Transagent: ${patchPath}`, {
        contextType: 'patch',
        patchPath,
        parentThreadId,
        spawnedByToolUseId,
      });
    }

    // chat — plain child thread; title seeded from the message.
    const title = message.slice(0, 60) + (message.length > 60 ? '...' : '');
    return this.deps.chatService.createThread(title || 'Transagent', {
      contextType: 'chat',
      parentThreadId,
      spawnedByToolUseId,
    });
  }
}
