/**
 * 0.1.69 Transagents ("bańki") — TransagentDispatcher.
 *
 * A chat/patch thread delegates a unit of work to a hidden CHILD thread of the
 * same spec via the `runTransagent` MCP tool. The dispatcher:
 *   1. founds a NEW child thread on every call — `parent_thread_id` = the current
 *      thread, `spawned_by_tool_use_id` = this tool_use's id. A spawn takes
 *      `plan_mode` from the call and its binding per `contextType`; a
 *      continuation (0.2.111) is validated, then copies the referenced banka's
 *      binding, plan mode, config snapshot and `last_session_id`, and its turn
 *      resumes that session (unforked) while the referenced row stays untouched,
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
import { checkResumeConfigLock, isSessionInFlight } from '../routes/resume-lock.js';

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
  /**
   * 0.2.111: resume the SESSION of an existing banka. The call still founds a new
   * child row of the caller, which inherits the banka's binding; the referenced
   * row is untouched.
   */
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
   *
   * Every relayed id is recorded in `relayed`: the child's own turn end sweeps only
   * its OWN request id, so `run()` cancels whatever the child left unanswered —
   * otherwise a child that times out / errors / is aborted alone would leave a live
   * card in the parent whose answer goes nowhere until the parent turn ends.
   */
  private relayUserInputToParent(
    parentThreadId: string,
    parentAdapter: ActiveAdapter,
    relayed: Set<string>,
  ): UserInputHandler {
    return (request: UserInputRequest): Promise<UserInputResponse> => {
      relayed.add(request.requestId);
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

    // 1. Found the child thread. 0.2.111 (M46): EVERY call founds a new row as a
    //    child of the calling thread — a continuation too — so each tool_use owns
    //    exactly one row (its panel shows exactly the work it ordered, and the
    //    caller's abort / delete always cascades to it).
    let child: ChatThread;
    if (input.threadId) {
      //    Continuation: validated first — every refusal lands BEFORE the INSERT,
      //    so a refused call leaves no row behind. Then the new row takes the
      //    referenced banka's binding, plan mode, config snapshot and session;
      //    `input.payload` and `input.planMode` are ignored, and the referenced
      //    row is only read, never updated.
      const banka = await this.validateContinuation(input.threadId, contextType);
      child = this.deps.chatService.createContinuationThread(banka.id, {
        parentThreadId,
        spawnedByToolUseId: toolUseId,
      });
    } else {
      // 0.2.90 — the conditional requirement is validated BEFORE branching, in
      // the same step as an out-of-set value: a `patch` call without
      // `payload.patchPath` is refused before any child thread exists, because a
      // child with an empty patch_path would break
      // `context_type='patch' ⇒ patch_path IS NOT NULL`.
      if (contextType === 'patch' && !(typeof payload.patchPath === 'string' && payload.patchPath)) {
        throw new DomainError('VALIDATION', "contextType='patch' requires payload.patchPath");
      }
      // Generic step, before the per-context branching: the columns every
      // context type shares, taken straight from the top-level call fields.
      // `plan_mode` comes from the call ONLY here, on a spawn.
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

    const relayed = new Set<string>();
    try {
      // 3. Run the child turn. The child renders via its own stream entry
      //    (GET /api/chat/stream/:childThreadId), not the parent transport.
      //    runAgentTurn registers activeAdapters[child.id] (with parentThreadId
      //    from the row) so the parent can nested-join — and gives the child its
      //    OWN idle clock (0.2.107). The parent's clock needs nothing from here:
      //    to the library the bubble is an open `runTransagent` tool_use, which
      //    stops the parent's idle clock until its tool_result.
      //    `onEvent` is a no-op — the child's events reach neither the parent's
      //    model context (that gets only `{ threadId, summary }`) nor the
      //    parent's SSE (the panel has its own source).
      const result = await this.opts.runTurn({
        thread: child,
        prompt: message,
        model: this.opts.model,
        architectureConfig: this.opts.architectureConfig,
        requestId: nanoid(12),
        consoleObserver: null,
        onEvent: () => {},
        ...(this.opts.interactive && parentAdapter
          ? { onUserInput: this.relayUserInputToParent(parentThreadId, parentAdapter, relayed) }
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
      // (handled by the MCP wrapper), and the parent's turn carries on. That
      // includes a child stopped by its OWN idle clock (`IDLE_TIMEOUT`), which
      // `runAgentTurn` has already mapped from `AdapterIdleTimeoutError`.
      // Still bracket-close the panel.
      parentAdapter?.emit({
        type: 'transagent_completed',
        childThreadId: child.id,
        toolUseId,
        status: 'error',
        timestamp: new Date().toISOString(),
      });
      throw err;
    } finally {
      if (parentAdapter) this.cancelRelayedInputs(relayed, parentAdapter);
    }
  }

  /**
   * Rejects the child's still-unanswered relayed questions and marks them resolved in
   * the parent's replay buffer, so neither a live-joiner nor F5 renders a dead card.
   * Mirrors `cancelPendingForRequest` for ids rather than a request id (not imported:
   * a value import of `agent-turn.ts` would close the cycle `runTurn` is injected to avoid).
   */
  private cancelRelayedInputs(relayed: Set<string>, parentAdapter: ActiveAdapter): void {
    for (const inputId of relayed) {
      const pending = this.deps.pendingInputs.get(inputId);
      if (!pending) continue;
      this.deps.pendingInputs.delete(inputId);
      pending.reject(new Error('child turn ended'));
      const events = parentAdapter.replay?.events ?? [];
      for (let i = 0; i < events.length; i++) {
        const current = events[i];
        if (current?.type !== 'user_input_request') continue;
        if ((current as { request?: { requestId?: string } }).request?.requestId !== inputId) continue;
        events[i] = { ...current, resolved: true, response: null };
      }
    }
  }

  /**
   * 0.2.111 (M46): the checks a continuation must pass before its row is founded,
   * IN THIS ORDER — the first mismatch refuses the call and no `chat_thread` row
   * is created:
   *   1. `threadId` exists (`NOT_FOUND`) and names a child row, not a top-level
   *      thread (`VALIDATION` → `INVALID_ARGS`): a top-level thread carries no
   *      banka binding, and taking over its session as a hidden child would pull
   *      the user's conversation out of every list. Whose child it is does NOT
   *      matter — a banka born in another top-level thread of this spec can be
   *      continued; the new row gets the caller as its parent regardless.
   *   2. `contextType` equals the banka's (`VALIDATION`) — a continuation cannot
   *      switch the binding.
   *   3. the banka's brief / patch file still exists (`NOT_FOUND`). A dangling
   *      `plan_path` passes: a plan degrades gracefully.
   *   4. no row in flight is resuming this banka's session (`STREAM_IN_PROGRESS`),
   *      read from the live-adapter registry. Not queued: a queue would eat the
   *      parent's idle-clock margin.
   *   5. the turn's config matches the banka's snapshot (`RESUME_CONFIG_LOCKED`) —
   *      the third entry point of the shared resume guard.
   */
  private async validateContinuation(
    threadId: string,
    contextType: 'brief' | 'chat' | 'patch',
  ): Promise<ChatThread> {
    const banka = this.deps.chatService.getThreadMeta(threadId);
    if (!banka) throw new DomainError('NOT_FOUND', `banka thread '${threadId}' not found`);
    if (!banka.parentThreadId) {
      throw new DomainError(
        'VALIDATION',
        `thread '${threadId}' is a top-level thread, not a banka — only a child thread can be continued`,
      );
    }

    if (banka.contextType !== contextType) {
      throw new DomainError(
        'VALIDATION',
        `contextType '${contextType}' does not match banka '${threadId}' (context type '${banka.contextType}') — a continuation cannot switch the binding`,
      );
    }

    if (banka.contextType === 'brief' && banka.briefPath) {
      await this.assertArtifactExists('brief', banka.briefPath, () =>
        this.deps.briefService.getBrief(banka.briefPath as string),
      );
    }
    if (banka.contextType === 'patch' && banka.patchPath) {
      await this.assertArtifactExists('patch', banka.patchPath, () =>
        this.deps.patchService.getPatch(banka.patchPath as string),
      );
    }

    if (isSessionInFlight(this.deps.activeAdapters, banka.id, banka.lastSessionId)) {
      throw new DomainError(
        'STREAM_IN_PROGRESS',
        `banka '${threadId}' has a turn in flight on its session — wait for it to finish; the call is not queued`,
      );
    }

    const lock = checkResumeConfigLock({
      snapshotJson: this.deps.chatService.getInitialArchitectureConfig(banka.id),
      lastSessionId: banka.lastSessionId ?? null,
      model: this.opts.model,
      architectureConfig: this.opts.architectureConfig,
      cwd: this.deps.cwd,
      roots: this.deps.roots,
    });
    if (lock) {
      const fields = lock.error.violations.map((v) => v.path).join(', ');
      throw new DomainError(
        'RESUME_CONFIG_LOCKED',
        // Not `lock.error.message`: that text tells a human to "start a new
        // conversation"; the agent's remedy is the hint below.
        `Model, reasoning and filesystem scope are locked for banka '${threadId}''s session. Changed: ${fields}.`,
        'Spawn a fresh banka (omit `threadId`) to run this work with the current config.',
      );
    }

    return banka;
  }

  /**
   * Refuses only a MISSING file. Any other read failure (a malformed frontmatter, an
   * I/O error) passes: the file exists, and `runAgentTurn` tolerates the same read
   * failure (it warns and runs without the snapshot) — an existence check must not
   * turn it into an undocumented refusal code.
   */
  private async assertArtifactExists(
    kind: 'brief' | 'patch',
    path: string,
    read: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await read();
    } catch (err) {
      const missing = err instanceof DomainError ? err.code === 'NOT_FOUND' : isFileNotFound(err);
      if (missing) {
        throw new DomainError('NOT_FOUND', `the banka's ${kind} '${path}' no longer exists`);
      }
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

function isFileNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}
