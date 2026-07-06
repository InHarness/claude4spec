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
