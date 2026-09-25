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
      "  - contextType='brief': creates a brief file against the CURRENT STATE (to_release: null —",
      '    the window\'s `to` end stays open) grounded in the `message` you pass (your analysis),',
      '    then runs a brief-editorial child.',
      '    Optional payload: { fromReleaseName? (defaults to the latest release), content? (initial',
      '    body of the brief file, passed straight through when the file is created — without it the',
      '    file starts with only its heading), suffix? (appended to the generated brief file slug) }.',
      "  - contextType='patch': resolves a patch — REQUIRED payload.patchPath; a call without it is",
      '    refused before any child thread is created. `payload` itself stays optional, because the',
      '    requirement is conditional on `contextType`.',
      "  - contextType='chat': a plain child chat turn.",
      '    Optional payload: { planPath? } — the path of an EXISTING plan file the child starts',
      '    attached to, so it continues that plan instead of starting one. Omit it and the child',
      '    is unattached and creates its own plan on its first `update_plan`. A planPath naming no',
      '    existing plan is INVALID_ARGS and NO child is created.',
      'Resumable: pass `threadId` to resume the session of an existing banka. Every call, spawn or',
      'continuation, creates a new child thread of the current thread and returns its id. A',
      "continuation inherits the referenced banka's binding and resumes its session, leaving the",
      'referenced thread untouched. To keep working with a banka, pass the `threadId` returned most',
      'recently.',
      '    `payload` and `planMode` are IGNORED on that path — the binding (planPath, patchPath, the',
      '    brief window), plan mode and locked session config come from the referenced banka.',
      'At most one child runs per turn (this tool_use blocks until the child finishes).',
      '`planMode: true` opens a freshly spawned child in plan mode (read-only builtins) — a top-level',
      'field, NOT a payload key. It is NOT inherited: omit it and the child runs unrestricted even if',
      'YOU are in plan mode.',
      'On failure the tool_result is `isError` with a flat `{ error, code }`. Codes:',
      '  - ABORTED / IDLE_TIMEOUT / TIMEOUT / AGENT_UNAVAILABLE / AGENT_ERROR — the CHILD turn ended',
      '    that way. ABORTED means a human stopped it; IDLE_TIMEOUT means the child went silent past',
      '    its own idle clock and was stopped — YOUR turn continues; AGENT_UNAVAILABLE',
      '    means it never started (retryable).',
      "  - NOT_FOUND — `threadId` names no thread, or the banka's brief / patch file no longer exists.",
      '  - INVALID_ARGS — the arguments do not describe a runnable child: contextType=\'patch\'',
      "    without payload.patchPath (when spawning), a contextType='chat' payload.planPath that names",
      '    no existing plan (or is not a string), a `threadId` of a top-level thread (not a banka), or',
      "    a contextType that differs from the banka's.",
      '  - STREAM_IN_PROGRESS — a turn is already resuming that banka\'s session; the call is not',
      '    queued. Retry once it has finished.',
      '  - RESUME_CONFIG_LOCKED — the model, reasoning or filesystem scope differs from the banka\'s',
      '    session; spawn a fresh banka (omit `threadId`) to work with the current config.',
      '  - INTERNAL — this server faulted; not a child-turn outcome, and not retryable as-is.',
      'A failed child stays resumable: continue its session with runTransagent({ threadId }) using',
      'the `threadId` you passed (or were last returned) — a failure returns no new id.',
    ].join('\n'),
    {
      contextType: z
        .enum(['brief', 'chat', 'patch'])
        .describe("For a continuation it must equal the referenced banka's context type."),
      message: z.string(),
      payload: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Per-contextType binding; patchPath is required for contextType='patch' when spawning. Ignored on continuation, where the binding comes from the referenced banka.",
        ),
      planMode: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Ignored on continuation, where the new child takes plan mode from the referenced banka, and never inherited from the parent thread.',
        ),
      threadId: z
        .string()
        .optional()
        .describe(
          "Id of an existing banka whose session to resume. The call creates a new child thread of the current thread, which inherits the banka's binding: context type, artifact path, plan mode and locked session config. The referenced thread is not modified. Omit to spawn a fresh banka.",
        ),
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
        // Every child failure collapses upward as the parent's tool_result
        // isError { code, message } — including a child stopped by its own idle
        // clock (IDLE_TIMEOUT); the caller's turn carries on. The collapse
        // returns no id of the row the failed turn founded — the session is
        // picked up again by continuing the `threadId` the caller passed.
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
