/**
 * Bounds the headless run-turn call (`c4s ask` / MCP peer tool / `POST
 * /api/threads/:id/ask`) on both ends of the wire: the client-side fetch
 * dispatcher (`src/core/agent/run-agent.ts`) and the server-side
 * `adapter.execute()` call (`src/server/routes/agent-turn.ts`). A single
 * shared constant keeps the two bounds from drifting apart.
 *
 * Interactive `POST /api/chat` turns get `TURN_TIMEOUT_MS` instead — a much
 * looser bound, for the reason spelled out there.
 */
export const ASK_TURN_TIMEOUT_MS = 15 * 60_000;

/**
 * The `timeoutMs` handed to `adapter.execute` for an INTERACTIVE `POST /api/chat`
 * turn — a CONTRACT BACKSTOP, not a turn-length policy (0.2.107).
 *
 * It used to be the only clock on the turn (60 min), so an agent that went
 * silent in its first minute held the user for an hour and then died with an
 * error indistinguishable from a hard failure. Silence is now detected by the
 * library's idle clock (`idleTimeoutMs`, agent-adapters >= 0.9.11), passed as
 * `IDLE_TIMEOUT_MS` below. This backstop is armed once at run start and never
 * re-armed; it covers the whole turn.
 *
 * It must still be passed — the library reads an omitted `timeoutMs` as "no
 * wall-clock bound at all", and the backstop is the policy. If it ever fires
 * FIRST, that is an idle-clock failure, not a normal end of turn.
 *
 * While work is OUTSTANDING the idle clock is stopped, and each kind of work is
 * bounded by ITS OWN cap (agent-adapters M01: "outstanding work is not unbounded
 * work") — deliberately no extra clock of ours on top (0.2.107 review, point 8):
 *
 *   - foreground Bash       → its own `timeout` (max 600 000 ms, Claude Code);
 *   - background task       → `BACKGROUND_HOLD_CAP_MS` (library hold cap);
 *   - `runTransagent` child → the child turn's own idle clock and backstop;
 *   - subagent              → its `maxTurns` (`plugin-subagents.ts`);
 *   - `user_input_request`  → none, on purpose: a human being slow is not a stall;
 *   - MCP tool call         → Claude Code's per-server tool timeout (~28 h by
 *                             default). agent-adapters has no way to set it yet
 *                             — the one real gap, reported to the library; until
 *                             then a wedged MCP tool is ended by this backstop.
 *
 * The invariants, asserted at server module load (`routes/agent-turn.ts`) and in `agent-turn.test.ts`:
 *
 *     TURN_TIMEOUT_MS >= 10 * IDLE_TIMEOUT_MS
 *     IDLE_TIMEOUT_MS  > BACKGROUND_HOLD_CAP_MS + BACKGROUND_WAKEUP_GRACE_MS (library)
 */
export const TURN_TIMEOUT_MS = 24 * 60 * 60_000;

/**
 * `idleTimeoutMs` handed to `adapter.execute` for an interactive turn (0.2.107):
 * the library ends a run that stays idle this long with `AdapterIdleTimeoutError`,
 * which we map to `IDLE_TIMEOUT`.
 *
 * The library's clock is NOT a last-sign-of-life timer. It advances only while
 * nothing is outstanding — an open `tool_use`, subagent, background task,
 * unanswered `user_input_request`, and the time we hold an event all stop it —
 * and it never resets: the budget is CUMULATIVE across the turn. Streaming text
 * and generating tool input spend it. Hence 60 min rather than the 10 min a
 * resettable watchdog would get: a long legitimate turn (dozens of pages
 * written) must fit in it, while an agent that truly went silent still ends
 * long before the 24 h backstop.
 *
 * A bubble child (M46) is, for its parent, an ordinary open `tool_use`, so the
 * parent's clock is stopped for as long as the child runs; the child gets its
 * own budget through `runAgentTurn`.
 *
 * MUST stay above `BACKGROUND_HOLD_CAP_MS` + the library's background grace (315 000 ms):
 * otherwise idle expiry could pre-empt the typed
 * `AdapterBackgroundHoldExpiredError` and "abandoned background work" would
 * become indistinguishable from "the turn went silent".
 */
export const IDLE_TIMEOUT_MS = 60 * 60_000;

/**
 * The turn-clock invariants, hard. Checked at server module load
 * (`routes/agent-turn.ts`), so a constant edit that breaks one refuses to boot
 * rather than degrading silently. `graceMs` is the library's own
 * `BACKGROUND_WAKEUP_GRACE_MS` (we do not override
 * `claude_backgroundGraceMs`), read there rather than mirrored here — this file
 * is shared with the client, which must not import the adapter runtime.
 *
 * Every clock must be finite. For the hold cap that is the library's rule
 * (`null`/`Infinity` disarm it). For `idleTimeoutMs` it is the opposite trap:
 * `Infinity` does NOT disarm the library's idle clock — `setTimeout` clamps it,
 * and the turn would die in ~1 ms. Omitting the field is the only way to have
 * no idle clock.
 */
export function assertTurnClockInvariants(clocks: {
  turnTimeoutMs: number;
  idleTimeoutMs: number;
  holdCapMs: number;
  graceMs: number;
}): void {
  const { turnTimeoutMs, idleTimeoutMs, holdCapMs, graceMs } = clocks;
  for (const [name, ms] of Object.entries(clocks)) {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error(`turn clocks: ${name} must be finite and positive, got ${ms}`);
    }
  }
  if (!(idleTimeoutMs > holdCapMs + graceMs)) {
    throw new Error(
      `turn clocks: idle timeout (${idleTimeoutMs}ms) must exceed hold cap + grace (${holdCapMs + graceMs}ms)`,
    );
  }
  if (!(turnTimeoutMs >= 10 * idleTimeoutMs)) {
    throw new Error(
      `turn clocks: backstop timeoutMs (${turnTimeoutMs}ms) must be at least 10x the idle timeout (${idleTimeoutMs}ms)`,
    );
  }
}

/**
 * `architectureConfig.claude_backgroundHoldCapMs` — how long the adapter keeps a
 * run open for background work that is making no visible progress.
 *
 * 5 min, against the library's 90 s default, because silence during a hold is
 * NORMAL: `background_task_progress` is not guaranteed, so a quiet task is not
 * a stalled one.
 *
 * MUST never be `null` or `Infinity` — the library reads both as "disarm the
 * cap", which would let a wedged background task hold a session open forever.
 */
export const BACKGROUND_HOLD_CAP_MS = 5 * 60_000;

/**
 * SIDE-BAND EVENTS — `warning` and `flush` — carry no position on the stream:
 * a `warning` can legitimately arrive after the final `result`, and a `flush`
 * marks a context-compaction boundary with an empty payload.
 *
 * There is deliberately no constant for the set, because nothing in this
 * codebase decides terminality by inspecting event types. An iteration ends
 * when the ASYNC GENERATOR IS EXHAUSTED and at no other moment — see the loop
 * in `runAgentTurn`. A named set here would read as the single source of truth
 * for a decision that is not made anywhere, so a future `hold_heartbeat` would
 * be added to it and change nothing.
 */

/**
 * The codes a turn can fail with, shared by every consumer that has to tell
 * one failure from another: the SSE `event: error` payload, the headless
 * `ask` route's HTTP status mapping, and `runTransagent`, which folds a
 * CHILD turn's failure into the parent's `tool_result`.
 */
export type AgentTurnErrorCode =
  | 'ABORTED'
  /**
   * 0.2.107: the library's idle clock ended the turn — `IDLE_TIMEOUT_MS` of
   * cumulative idle time with nothing outstanding (`AdapterIdleTimeoutError`).
   * A class of its own, so `ABORTED` now always means a human Stop.
   */
  | 'IDLE_TIMEOUT'
  /**
   * The `timeoutMs` BACKSTOP expired (`AdapterTimeoutError`). Since 0.2.107 this
   * is a symptom of an idle-clock failure, not a normal end of turn.
   */
  | 'TIMEOUT'
  | 'AGENT_UNAVAILABLE'
  | 'AGENT_ERROR'
  /**
   * A requested deny-group is not enforceable on this architecture, so the turn
   * REFUSED TO START. Distinct from a turn that ran and failed: no assistant
   * message is persisted and the stream carries exactly one `error` plus
   * `done` — no `adapter_ready`, no `result`.
   */
  | 'TOOL_POLICY_REFUSED'
  /**
   * `claude_backgroundHoldCapMs` elapsed while the run was parked — on
   * background work, a subagent delegation, or both. Carries `capMs`; the
   * counts come from our own two started-minus-completed registries, because
   * the library's error carries no task list (`backgroundHoldExpiredMessage`).
   */
  | 'BACKGROUND_HOLD_EXPIRED';

/**
 * 0.2.109: the `BACKGROUND_HOLD_EXPIRED` message, built from the turn's TWO
 * abandoned-work registries (background tasks, subagent delegations), each
 * started-minus-completed. They are never summed — every non-empty one is
 * named on its own. With both empty the message carries no count at all: the
 * hold expired with no recognized cause, and inventing a "0 tasks" would state
 * a cause that was not there. The content always comes from the registries,
 * never from `capMs` alone.
 */
export function backgroundHoldExpiredMessage(
  capMs: number,
  backgroundTasks: number,
  delegations: number,
): string {
  const parts: string[] = [];
  if (backgroundTasks > 0) parts.push(`${backgroundTasks} background task(s)`);
  if (delegations > 0) parts.push(`${delegations} subagent delegation(s)`);
  if (parts.length === 0) {
    return `background hold expired after ${capMs}ms with no recognized cause`;
  }
  return `background hold expired after ${capMs}ms with ${parts.join(' and ')} still running`;
}

/**
 * 0.2.109: an event produced by the MAIN model — the proof that a parked turn
 * resumed. Subagent traffic does not count: a delegation's own text and tool
 * calls stream while the main model is parked, which is the whole reason a
 * parked turn is not over. Shared so the server (continuation `turn_start`)
 * and the client (`nextParked`) read "resumed" from the same rule.
 */
export function isMainModelEvent(event: { type: string } & Record<string, unknown>): boolean {
  switch (event.type) {
    case 'text_delta':
    case 'thinking':
      return !event.isSubagent;
    case 'tool_use':
      return !event.isSubagent && !event.subagentTaskId;
    case 'assistant_message':
      return !(event.message as { subagentTaskId?: string } | undefined)?.subagentTaskId;
    default:
      return false;
  }
}

/**
 * Typed blad tury — pozwala konsumentom (headless `ask`, `runTransagent`)
 * zmapowac powod zakonczenia na status HTTP / kod narzedzia. Te same kody co
 * SSE `event: error`.
 *
 * Lives in `shared/` rather than next to `runAgentTurn` because the MCP layer
 * has to narrow on it (`src/server/mcp/transagent-tools.ts`) and importing a
 * route module from a tool server would drag the whole express stack along
 * for one `instanceof`.
 */
export class AgentTurnError extends Error {
  constructor(
    public code: AgentTurnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentTurnError';
  }
}
