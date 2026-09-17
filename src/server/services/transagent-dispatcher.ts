/**
 * 0.1.69 Transagents ("bańki") — TransagentDispatcher.
 *
 * A chat/patch thread delegates a unit of work to a hidden CHILD thread of the
 * same spec via the `runTransagent` MCP tool. The dispatcher:
 *   1. resolves or creates the child thread — a generic step first (its
 *      `parent_thread_id` = the current thread, `spawned_by_tool_use_id` = this
 *      tool_use's id, `plan_mode` = the call's `planMode`), then the binding
 *      per `contextType`,
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
  UserInputHandler,
  UserInputRequest,
  UserInputResponse,
} from '@inharness-ai/agent-adapters';
import type {
  ActiveAdapter,
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
  /** Per-contextType binding hints (e.g. `{ fromReleaseName, patchPath, suffix, planPath }`). */
  payload?: Record<string, unknown>;
  /**
   * 0.2.30: open the child banka in plan mode. TOP-LEVEL on purpose, never a
   * `payload` key — the split is "top-level = generic for the thread, `payload`
   * = specific to the context type", and `plan_mode` is a plain `chat_thread`
   * column shared by every context type (the one the UI toggle flips).
   *
   * NOT inherited from the parent thread: omitted ⇒ `false`, exactly like the
   * toggle on a hand-created new thread. Inheriting would be a regression — a
   * `contextType: 'patch'` banka spawned from a plan-mode parent would lose
   * `Write`/`Edit`/`Bash` and could no longer edit the spec, which is the only
   * reason it exists. A caller who wants inheritance passes the flag itself.
   */
  planMode?: boolean;
  /** Continue an existing child banka instead of creating one. */
  threadId?: string;
}

/**
 * 0.2.30: the `chat_thread` columns that are generic across every context type,
 * resolved ONCE from the top-level call fields before the per-context branching
 * and spread verbatim into whichever create call the branch makes. Keeping them
 * in one object is what stops `plan_mode` from being restated (and drifting) in
 * each of the three bindings.
 */
interface GenericThreadColumns {
  parentThreadId: string;
  spawnedByToolUseId: string;
  planMode: boolean;
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
  /**
   * 0.2.87 (M46): the parent turn has a human on the other end (it was started with
   * an `onUserInput` handler). Only then does the child get one — elicitation crosses
   * the thread boundary into the PARENT's panel. A headless parent (`/ask`) passes
   * `false`, and its child keeps no handler, exactly like the parent.
   */
  interactive?: boolean;
}

export class TransagentDispatcher {
  constructor(
    private deps: AgentTurnDeps,
    private opts: TransagentDispatcherOpts,
  ) {}

  /**
   * 0.2.87 (M46): elicitation across the thread boundary. A question raised by the
   * child renders in the PARENT's panel — it is emitted on the parent's stream (so
   * the POST client and every live-joiner see it, replay included), persisted as a
   * `user_input_request` row of the parent thread, and parked in `pendingInputs`
   * under its own `requestId`. `POST /api/chat/user-input` answers it by that id,
   * unchanged. The pending entry is bound to the PARENT's request id, so a
   * conscious abort of the parent (`cancelPendingForRequest`) rejects it too.
   */
  private relayUserInputToParent(
    parentThreadId: string,
    parentAdapter: ActiveAdapter,
  ): UserInputHandler {
    return (request: UserInputRequest): Promise<UserInputResponse> => {
      parentAdapter.emit({ type: 'user_input_request', request });
      this.deps.chatService.addMessage(
        parentThreadId,
        'user_input_request',
        JSON.stringify(request),
        null,
        request.requestId,
      );
      return new Promise<UserInputResponse>((resolve, reject) => {
        this.deps.pendingInputs.set(request.requestId, {
          resolve,
          reject,
          requestIdsForRequest: parentAdapter.requestId,
        });
      });
    };
  }

  async run(input: TransagentRunInput): Promise<TransagentRunResult> {
    const { parentThreadId, contextType, message } = input;
    const payload = input.payload ?? {};

    // The parent's tool_use id (race-free via the agent-turn loop). Used as the
    // child's spawned_by_tool_use_id and echoed on the bracketing events.
    const toolUseId = await this.opts.takeToolUseId();

    // 1. Resolve/create the child thread.
    //    Continuation SKIPS prepare-per-context entirely — including the generic
    //    step below — so `input.planMode` is deliberately ignored here: an
    //    existing banka keeps the posture it was created with. Nothing on this
    //    branch may `UPDATE chat_thread SET plan_mode`.
    //    `input.payload` is ignored for the same reason and with the same reach:
    //    every binding (plan_path, patch_path, the brief window) is decided at
    //    creation, so a continuation cannot re-point an existing banka at another
    //    plan. The tool description states it — this is the code that means it.
    let child: ChatThread;
    if (input.threadId) {
      const existing = this.deps.chatService.getThreadMeta(input.threadId);
      if (!existing) throw new DomainError('NOT_FOUND', `child thread '${input.threadId}' not found`);
      if (existing.parentThreadId !== parentThreadId) {
        throw new DomainError('VALIDATION', `thread '${input.threadId}' is not a child of this thread`);
      }
      child = existing;
    } else {
      // Generic step, before the per-context branching: the columns every
      // context type shares, taken straight from the top-level call fields.
      const generic: GenericThreadColumns = {
        parentThreadId,
        spawnedByToolUseId: toolUseId,
        planMode: input.planMode ?? false,
      };
      child = await this.createChild(contextType, message, payload, generic);
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
        ...(this.opts.interactive && parentAdapter
          ? { onUserInput: this.relayUserInputToParent(parentThreadId, parentAdapter) }
          : {}),
      });

      // 4. Completion — return only the summary to the parent LLM's context.
      parentAdapter?.emit({
        type: 'transagent_completed',
        childThreadId: child.id,
        toolUseId,
        status: 'completed',
        // 0.2.87 (M46): the completion marker carries the same summary the parent LLM gets.
        summary: result.answer,
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
   *   - brief → create a brief file against the current state (an OPEN `to` end:
   *     to_release:null, from=payload.fromReleaseName ?? latest) then a child
   *     brief thread. The channel is reserved for that window shape, which is
   *     described by the window itself — there is no provenance label to set.
   *   - patch → child patch thread (requires payload.patchPath).
   *   - chat  → plain child chat thread, optionally already attached to an
   *     EXISTING plan (payload.planPath); omitted ⇒ plan_path NULL and the
   *     child creates its own plan on its first `update_plan`.
   *
   * Each branch spreads `generic` (parent_thread_id, spawned_by_tool_use_id,
   * plan_mode) and adds ONLY its own binding fields — the generic columns are
   * decided by the caller, once, for all three.
   */
  private async createChild(
    contextType: 'brief' | 'chat' | 'patch',
    message: string,
    payload: Record<string, unknown>,
    generic: GenericThreadColumns,
  ): Promise<ChatThread> {
    if (contextType === 'brief') {
      // `createBrief` expands an OMITTED `fromReleaseName` to the latest release
      // — no need to resolve it here too. It must stay `undefined` and not
      // `null`: `null` is a different window (open at the start), and with
      // `to: null` it would be no window at all → VALIDATION.
      const fromReleaseName =
        typeof payload.fromReleaseName === 'string' ? payload.fromReleaseName : undefined;
      const suffix = typeof payload.suffix === 'string' ? payload.suffix : undefined;
      const content = typeof payload.content === 'string' ? payload.content : undefined;
      const { briefPath } = await this.deps.briefService.createBrief({
        fromReleaseName,
        toReleaseName: null,
        content,
        suffix,
      });
      const { threadId } = this.deps.briefService.createThreadForBrief({
        path: briefPath,
        ...generic,
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
        ...generic,
      });
    }

    // chat — plain child thread; title seeded from the message.
    const planPath = await this.resolveChatPlanPath(payload);
    const title = message.slice(0, 60) + (message.length > 60 ? '...' : '');
    return this.deps.chatService.createThread(title || 'Transagent', {
      contextType: 'chat',
      ...(planPath !== null ? { planPath } : {}),
      ...generic,
    });
  }

  /**
   * `contextType='chat'`'s only payload key: the plan the child starts attached
   * to. Three outcomes, and the two refusals are the point of it existing —
   * `payload` is typed `z.record(z.string(), z.unknown())` at the tool boundary,
   * so nothing upstream rejects a malformed or dangling key and a silently
   * dropped `planPath` is exactly the bug this replaced (the child looked as if
   * the parent had never named a plan).
   *
   *   - key absent (or explicitly null) → `null`: nothing is passed to
   *     `createThread`, `plan_path` stays NULL, and the child upserts its own
   *     plan. This is the default path and must not change.
   *   - key present but not a string → `VALIDATION`.
   *   - key present as a string → validated through the ONE shared gate,
   *     {@link PlanService.assertPlanExists}, so this and
   *     `POST /api/plans/:planId/create-thread` cannot disagree about what
   *     counts as a plan. A dangling path is `VALIDATION`, never an attach.
   *
   * Every refusal is raised HERE, before any thread is created, so a bad path
   * leaves no orphan child behind. `VALIDATION` is the repo-wide service code;
   * the MCP wrapper renames it to this tool's documented `INVALID_ARGS`.
   */
  private async resolveChatPlanPath(payload: Record<string, unknown>): Promise<string | null> {
    const raw = payload.planPath;
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new DomainError('VALIDATION', 'payload.planPath must be a non-empty string');
    }
    try {
      await this.deps.planService.assertPlanExists(raw);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new DomainError(
          'VALIDATION',
          `payload.planPath '${raw}' is not an existing plan: ${err.message}`,
        );
      }
      throw err;
    }
    return raw;
  }
}
