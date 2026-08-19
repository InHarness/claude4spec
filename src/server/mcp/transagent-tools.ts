/**
 * 0.1.69 Transagents — `transagent-tools` MCP server.
 *
 * Single tool `runTransagent`: delegate a unit of work to a hidden CHILD thread
 * ("banka") of the SAME spec, running in a chosen `contextType`. The child runs
 * a full turn (side-effecting artifacts, live stream into the parent panel) and
 * returns ONLY a `summary` to the parent LLM's context — keeping the parent's
 * context budget free of the child's full transcript.
 *
 * Per-request instance (like `plan-tools` / `brief-tools`): `parentThreadId` and
 * the `dispatcher` are captured from the parent turn. Mounted ONLY for
 * `context_type ∈ {chat, patch}` and never inside a child banka (recursion depth
 * 1) — both guards live in agent-turn.ts.
 *
 * Read-only cross-spec counterpart: `c4s-tools` (consults a DIFFERENT spec).
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { toolError } from '../operations/envelope.js';
import type { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { DomainError } from '../services/tags.js';
import { AgentTurnError } from '../../shared/agent-turn.js';

/** Tool name as the SDK reports it (`mcp__<server>__<tool>`) — used by the
 *  agent-turn loop to correlate the tool_use event with the dispatcher. */
export const TRANSAGENT_TOOL_FULL_NAME = 'mcp__transagent-tools__runTransagent';

export interface TransagentToolsContext {
  parentThreadId: string;
  dispatcher: TransagentDispatcher;
}

export function buildTransagentToolsServer(ctx: TransagentToolsContext): CapturedMcpServer {
  const runTransagent = mcpTool(
    'runTransagent',
    [
      'Delegate a unit of work to a hidden CHILD thread ("banka") of THIS specification.',
      'The child runs a full turn in the chosen `contextType` (brief | chat | patch), may produce',
      'side-effecting artifacts, streams live into your panel, and returns ONLY a concise `summary`',
      'to your context — its full transcript stays hidden, keeping your context budget small.',
      'Use it to hand off self-contained work: "turn this analysis into a brief", "split this plan",',
      '"draft the patch for X". Returns { threadId, summary }.',
      "  - contextType='brief': creates an ANALYSIS brief file (source: analysis, to_release: null)",
      '    grounded in the `message` you pass (your analysis), then runs a brief-editorial child.',
      '    Optional payload: { fromReleaseName?, suffix?, content? }.',
      "  - contextType='patch': resolves a patch — payload MUST include { patchPath }.",
      "  - contextType='chat': a plain child chat turn.",
      'Continue an existing child by passing its `threadId` (omit `contextType` semantics then).',
      'At most one child runs per turn (this tool_use blocks until the child finishes).',
      '`planMode: true` opens the child in plan mode (read-only builtins) — a top-level field, NOT a',
      'payload key. It is NOT inherited: omit it and the child runs unrestricted even if YOU are in',
      'plan mode. It is ignored when continuing an existing child via `threadId` — a banka\'s posture',
      'is fixed when it is created.',
      'On failure the tool_result is `isError` with a flat `{ error, code }`. Codes:',
      '  - ABORTED / TIMEOUT / AGENT_UNAVAILABLE / AGENT_ERROR — the CHILD turn ended that way.',
      '    ABORTED means a human stopped it; AGENT_UNAVAILABLE means it never started (retryable).',
      '  - NOT_FOUND — `threadId` names no thread, or none of yours.',
      '  - INVALID_ARGS — the arguments do not describe a runnable child (e.g.',
      "    contextType='patch' without payload.patchPath).",
      'A failed child keeps its last good summary: read it back with runTransagent({ threadId }).',
    ].join('\n'),
    {
      contextType: z.enum(['brief', 'chat', 'patch']),
      message: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
      planMode: z.boolean().optional().default(false),
      threadId: z.string().optional(),
    },
    async (input) => {
      try {
        const result = await ctx.dispatcher.run({
          parentThreadId: ctx.parentThreadId,
          contextType: input.contextType as 'brief' | 'chat' | 'patch',
          message: String(input.message ?? ''),
          payload:
            input.payload && typeof input.payload === 'object'
              ? (input.payload as Record<string, unknown>)
              : undefined,
          planMode: input.planMode === true,
          threadId: typeof input.threadId === 'string' ? input.threadId : undefined,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        // Non-abort child failure collapses upward as the parent's tool_result
        // isError { code, message }. The last good summary remains readable via
        // runTransagent({ threadId }).
        const { code, hint } = transagentErrorCode(err);
        const message = err instanceof Error ? err.message : String(err);
        return toolError(code, message, hint);
      }
    },
  );

  return createMcpServer({
    name: 'transagent-tools',
    tools: [runTransagent],
  });
}

/**
 * The tool's error taxonomy, and the reason it is not just `err.code`.
 *
 * Three kinds of failure arrive here and they used to collapse into one. A
 * CHILD TURN that was aborted or timed out throws `AgentTurnError`, which is
 * not a `DomainError` — so `ABORTED` and `TIMEOUT` both reached the parent as
 * a flat `AGENT_ERROR`, and a parent agent could not tell "the user stopped
 * it" from "the child genuinely failed". Those codes pass through verbatim
 * now, `AGENT_UNAVAILABLE` included: a child that never started is a fourth
 * outcome, and folding it into `AGENT_ERROR` would lose the one that is worth
 * retrying. `ask` already exposes it for the same reason.
 *
 * The dispatcher's own `VALIDATION` is renamed to `INVALID_ARGS` at this
 * boundary rather than at the source. `VALIDATION` is the repo-wide service
 * code for a bad argument (tags, entities, everything); `INVALID_ARGS` is
 * what THIS tool's contract documents. Renaming it in the service would
 * change a vocabulary shared by callers that have nothing to do with bankas.
 *
 * `contextType` outside `brief|chat|patch` deliberately stays a zod rejection
 * rather than `INVALID_ARGS`: the schema is a `z.enum`, and loosening it to
 * `z.string()` so this function could reject it by hand would trade a
 * protocol-level guarantee for a spelling.
 */
function transagentErrorCode(err: unknown): { code: string; hint?: string } {
  if (err instanceof AgentTurnError) return { code: err.code };
  if (err instanceof DomainError) {
    return { code: err.code === 'VALIDATION' ? 'INVALID_ARGS' : err.code, hint: err.hint };
  }
  // Default stays `AGENT_ERROR` rather than `INTERNAL`: a child turn that
  // failed is not this server faulting.
  return { code: 'AGENT_ERROR' };
}
