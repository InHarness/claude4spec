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
 * error indistinguishable from a hard failure. Silence is now detected by OUR
 * idle watchdog (`IDLE_TIMEOUT_MS`), because the library exposes no way to
 * extend or re-arm this timer: no `resetTimeoutOnProgress`, no `onProgress`, no
 * `extendTimeout()`, no `signal`, no `idleTimeoutMs`. It runs from the start of
 * the iteration and covers the whole turn.
 *
 * It must still be passed — omitting it is left unspecified by the contract,
 * and the backstop is the policy. If it ever fires FIRST, that is a watchdog
 * failure, not a normal end of turn.
 *
 * The invariants, asserted below at module load and in `agent-turn.test.ts`:
 *
 *     TURN_TIMEOUT_MS >= 10 * IDLE_TIMEOUT_MS
 *     IDLE_TIMEOUT_MS  > BACKGROUND_HOLD_CAP_MS + BACKGROUND_GRACE_MS
 */
export const TURN_TIMEOUT_MS = 24 * 60 * 60_000;

/**
 * Our idle watchdog (0.2.107): a turn that emits no SIGN OF LIFE for this long
 * is aborted with `IDLE_TIMEOUT`.
 *
 * Re-armed by every adapter event in the sign-of-life set (the replay types plus
 * `adapter_ready`, plus a bubble child's events), NEVER by the SSE keepalive —
 * that one ticks every 20 s whether or not the adapter is alive, and a watchdog
 * fed by it would never fire. Paused, not merely re-armed, while an elicitation
 * (`user_input_request`) waits for a human.
 *
 * MUST stay above `BACKGROUND_HOLD_CAP_MS + BACKGROUND_GRACE_MS` (315 000 ms):
 * otherwise the watchdog's abort pre-empts the typed
 * `AdapterBackgroundHoldExpiredError` and "abandoned background work" becomes
 * indistinguishable from "the turn went silent". 600 000 ms is ~2x of margin.
 */
export const IDLE_TIMEOUT_MS = 600_000;

/**
 * `architectureConfig.claude_backgroundGraceMs` — the LIBRARY'S default, which
 * we do not override. Mirrored here only so the idle invariant can be checked
 * against the real sum; change it together with the library default.
 */
export const BACKGROUND_GRACE_MS = 15_000;

/**
 * How much longer a parent's idle clock runs than its bubble child's (M46).
 *
 * The child keeps the full `IDLE_TIMEOUT_MS` on its own watchdog; the PARENT's
 * clock is lengthened by this delta for as long as a bubble is open. The child
 * must fire FIRST, and this is the window the dispatcher has to collapse the
 * silent child turn into the parent's `isError` tool result — so the parent
 * collects its child's failure instead of dying with it. Not a fourth clock,
 * a delta on the existing one.
 *
 * Margins would accumulate with nesting (a grandparent waits two margins longer
 * than its grandchild); today the depth guard keeps it at one level.
 */
export const TRANSAGENT_IDLE_MARGIN_MS = 30_000;

/**
 * The three turn-clock invariants, hard. Thrown at module load, so a constant
 * edit that breaks one refuses to boot rather than degrading silently.
 */
export function assertTurnClockInvariants(clocks: {
  turnTimeoutMs: number;
  idleTimeoutMs: number;
  holdCapMs: number;
  graceMs: number;
}): void {
  const { turnTimeoutMs, idleTimeoutMs, holdCapMs, graceMs } = clocks;
  if (!Number.isFinite(holdCapMs) || holdCapMs <= 0) {
    throw new Error(`turn clocks: background hold cap must be finite and positive, got ${holdCapMs}`);
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

assertTurnClockInvariants({
  turnTimeoutMs: TURN_TIMEOUT_MS,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  holdCapMs: BACKGROUND_HOLD_CAP_MS,
  graceMs: BACKGROUND_GRACE_MS,
});

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
   * 0.2.107: OUR idle watchdog aborted the turn — no sign of life for
   * `IDLE_TIMEOUT_MS`. Same `AdapterAbortError` as a user Stop underneath; the
   * discriminator is `ActiveAdapter.abortReason`, never the exception class.
   */
  | 'IDLE_TIMEOUT'
  /**
   * The `timeoutMs` BACKSTOP expired (`AdapterTimeoutError`). Since 0.2.107 this
   * is a symptom of a watchdog failure, not a normal end of turn.
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
   * `claude_backgroundHoldCapMs` elapsed while background work was still in
   * flight. Carries `capMs`; the count of abandoned tasks comes from our own
   * started-minus-completed registry, because the library's error carries no
   * task list.
   */
  | 'BACKGROUND_HOLD_EXPIRED';

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
