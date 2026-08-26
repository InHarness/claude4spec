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
 * Bounds an INTERACTIVE `POST /api/chat` turn.
 *
 * This path used to pass no timeout at all, deliberately: a turn can pause for
 * many minutes on `onUserInput` while a human decides, and the adapter's timer
 * runs from turn-start regardless of that activity. 0.2.50 makes a bound
 * mandatory anyway, because the background-task hold cap needs something above
 * it to be meaningful.
 *
 * The invariant, asserted in `agent-turn.clocks.test.ts`:
 *
 *     TURN_TIMEOUT_MS > BACKGROUND_HOLD_CAP_MS
 *
 * If the two ever cross, a hold that outlives its cap surfaces as a bare
 * `AdapterTimeoutError` instead of the typed `AdapterBackgroundHoldExpiredError`
 * — and we lose the ability to tell "the hold expired" from "the turn hung",
 * which are different bugs with different fixes. 60 min vs 5 min leaves 12x of
 * headroom.
 */
export const TURN_TIMEOUT_MS = 60 * 60_000;

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
 * Event types excluded from end-of-turn detection.
 *
 * Terminality reads "the last `result` that is NOT side-band (or a terminal
 * `error`)" — never "the last event that isn't `warning` and isn't `flush`".
 * The difference matters when the set grows: adding a type here must be the
 * ONLY edit required, so no site is allowed to spell these names by hand.
 *
 * `warning` qualifies because its position on the stream carries no meaning —
 * it can legitimately arrive after the final `result`. `flush` qualifies
 * because it marks a context-compaction boundary and has an empty payload.
 *
 * Next expected member: `hold_heartbeat`, when the dependency reaches 0.10.0.
 */
export const SIDE_BAND_EVENT_TYPES: ReadonlySet<string> = new Set(['warning', 'flush']);

/**
 * The codes a turn can fail with, shared by every consumer that has to tell
 * one failure from another: the SSE `event: error` payload, the headless
 * `ask` route's HTTP status mapping, and `runTransagent`, which folds a
 * CHILD turn's failure into the parent's `tool_result`.
 */
export type AgentTurnErrorCode =
  | 'ABORTED'
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
