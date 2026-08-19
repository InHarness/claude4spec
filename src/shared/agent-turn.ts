/**
 * Bounds the headless run-turn call (`c4s ask` / MCP peer tool / `POST
 * /api/threads/:id/ask`) on both ends of the wire: the client-side fetch
 * dispatcher (`src/core/agent/run-agent.ts`) and the server-side
 * `adapter.execute()` call (`src/server/routes/agent-turn.ts`). A single
 * shared constant keeps the two bounds from drifting apart.
 *
 * Deliberately NOT applied to interactive `POST /api/chat` turns — those can
 * legitimately pause for many minutes on `onUserInput` (human tool-approval
 * prompts), and the underlying adapter's timeout timer runs from turn-start
 * to completion regardless of that activity.
 */
export const ASK_TURN_TIMEOUT_MS = 15 * 60_000;

/**
 * The codes a turn can fail with, shared by every consumer that has to tell
 * one failure from another: the SSE `event: error` payload, the headless
 * `ask` route's HTTP status mapping, and `runTransagent`, which folds a
 * CHILD turn's failure into the parent's `tool_result`.
 */
export type AgentTurnErrorCode = 'ABORTED' | 'TIMEOUT' | 'AGENT_UNAVAILABLE' | 'AGENT_ERROR';

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
