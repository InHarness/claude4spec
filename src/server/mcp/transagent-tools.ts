/**
 * 0.1.69 Transagents — `transagent-tools` MCP server.
 *
 * Single tool `runTransagent`: delegate a unit of work to a hidden CHILD thread
 * ("banka") of the SAME spec, running in a chosen `contextType`. The child runs
 * a full turn (side-effecting artifacts, live stream into the parent panel) and
 * returns ONLY a `summary` to the parent LLM's context — keeping the parent's
 * context budget free of the child's full transcript.
 *
 * 2.1.18 (M46 `9w7zk9as`): one banka in flight at a time, not one per parent
 * turn — further calls in the same turn go through once the previous one has
 * returned (the dispatcher serializes them). A series of bubbles is composed by
 * the orchestrator from the lists below and this blocking call; there is no
 * `run_series` tool.
 *
 * Per-request instance (like `plan-tools` / `brief-tools`): `parentThreadId` and
 * the `dispatcher` are captured from the parent turn. Mounted ONLY for a
 * `context_type='chat'` thread with `parent_thread_id IS NULL` (2.1.18: `patch`
 * lost it — the registry's declared `transagentTools` column) and never inside a
 * child banka (recursion depth 1) — both guards live in agent-turn.ts.
 *
 * 2.1.18 (M44 `3f5ej79s`, M23 `m23mcp01`) — the same server also carries the
 * orchestrator's list of the patch set, `list_patches` (owned by M23, grouped
 * here only because the top-level chat thread is its sole consumer: it builds a
 * series queue from it and re-checks the `applied` flag after every banka). The
 * patch thread, closed on one `patch_path`, never sees it — it has no
 * `transagent-tools` at all.
 *
 * 2.1.18 (M10 `m10mcp00`, M44 `3f5ej79s`) — and `list_plans`, owned by M10: the
 * set of plans the orchestrator picks a `planPath` for a banka from. `plan-tools`
 * still carries no list on a thread — the agent editing a plan sees only its own.
 *
 * 2.1.18 (M21 `01ytpznn`, M44 `3f5ej79s`, M05 `iatop5pj`) — and `list_briefs`,
 * owned by M21: the orchestrator turns a brief's name into its path (the
 * `brief` filter of `list_patches`) and orients itself in the set. It is not a
 * banka address — a brief banka always founds a new brief. `brief-tools` stays
 * at its four tools, and a `brief` thread has no `transagent-tools`, so the
 * brief thread's isolation is untouched.
 *
 * Read-only cross-spec counterpart: `c4s-tools` (consults a DIFFERENT spec).
 */

import { createMcpServer, mcpTool, type CapturedMcpServer, type McpToolDefinition } from '../plugin-runtime/index.js';
import { z } from 'zod';
import { toolError, toolFailure, toolSuccess } from '../operations/envelope.js';
import { DEFAULT_LIMITS, paginate } from '../discovery/pagination.js';
import { toIso } from '../services/artifact-content.js';
import type { BriefService } from '../services/brief.js';
import type { PatchService } from '../services/patch.js';
import type { PlanService } from '../services/plan.js';
import type { TransagentDispatcher } from '../services/transagent-dispatcher.js';
import { DomainError } from '../services/tags.js';
import { AgentTurnError } from '../../shared/agent-turn.js';

/** Tool name as the SDK reports it (`mcp__<server>__<tool>`) — used by the
 *  agent-turn loop to correlate the tool_use event with the dispatcher. */
export const TRANSAGENT_TOOL_FULL_NAME = 'mcp__transagent-tools__runTransagent';

export interface TransagentToolsContext {
  parentThreadId: string;
  dispatcher: TransagentDispatcher;
  /**
   * 2.1.18 — the patch set behind `list_patches`. Optional only for rigs that
   * exercise `runTransagent` alone; the turn handler always passes it.
   */
  patches?: Pick<PatchService, 'listPatches'>;
  /**
   * 2.1.18 — the brief set behind `list_briefs`. Optional only for rigs that
   * exercise `runTransagent` alone; the turn handler always passes it.
   */
  briefs?: Pick<BriefService, 'listBriefs'>;
  /**
   * 2.1.18 — the plan set behind `list_plans`. Optional only for rigs that
   * exercise `runTransagent` alone; the turn handler always passes it.
   */
  plans?: Pick<PlanService, 'listPlans'>;
  /** The project `list_patches` / `list_briefs` / `list_plans` answer for — the response-size ring's key. */
  projectId?: string | null;
}

/** Tool names this server can carry, in registration order. */
export const TRANSAGENT_TOOL_NAMES = ['runTransagent', 'list_patches', 'list_briefs', 'list_plans'] as const;

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
      'Only one banka is in flight at a time, because the call blocks until the child finishes;',
      'further calls in the same turn are allowed once the previous one has returned. A series —',
      'for example every unapplied patch of one brief — is that loop on your side, not a separate',
      'tool: fix the queue once with a list tool (list_patches / list_plans, paged to',
      '`hasMore: false`), make one call per item, each with the artifact address in `payload`',
      '(patchPath / planPath), and re-list after each return to report what was done — the call',
      'returns only { threadId, summary }. A banka that ends `isError` does not end your turn; you',
      'decide whether the series goes on.',
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

  const tools: McpToolDefinition[] = [runTransagent];
  if (ctx.patches) tools.push(buildListPatchesTool(ctx.patches, ctx.projectId ?? null));
  if (ctx.briefs) tools.push(buildListBriefsTool(ctx.briefs, ctx.projectId ?? null));
  if (ctx.plans) tools.push(buildListPlansTool(ctx.plans, ctx.projectId ?? null));

  return createMcpServer({
    name: 'transagent-tools',
    tools,
  });
}

/**
 * 2.1.18 (M23 `m23brsv01` / `m23mcp01`) — `list_patches`, the patch set as the
 * orchestrator reads it. Filters `brief` and `applied` (a patch without the
 * `applied` key — a legacy `status: completed` one included — counts as
 * `false`); the ORDER is `patchService.listPatches`' own (`created_at`
 * ascending, tie by `path`, undated last); the WINDOW follows M39's implicit
 * matrix (`limit` / `offset` with a finite default, `total` before the slice,
 * `hasMore`). `echo-free`: rows carry the address and the flag, no content.

 *
 * ASSUMPTION:dev-0003 — rendered here although the catalog row's `internal` cell
 * still reads `n/a` at 2.1.18 (Faza B pending); no catalog row is declared, and
 * the default page size (50) is ours — M39 names none for this list.
 */
function buildListPatchesTool(patches: Pick<PatchService, 'listPatches'>, projectId: string | null) {
  return mcpTool(
    'list_patches',
    [
      'List the patches of this specification — the set a patch series is planned from.',
      'Ordered by `created_at` ascending (ties by `path`; a patch without `created_at` comes last).',
      'Filter with `brief` (a brief path relative to the briefs root — only that brief\'s patches)',
      'and `applied` (`false` = not yet applied; a patch with no `applied` field counts as false).',
      'Each row: { path, title, brief, patchKind, applied, createdAt }; `path` is what',
      "runTransagent({ contextType: 'patch', payload: { patchPath } }) takes. Paged: `limit` / `offset`,",
      'answered with `total` and `hasMore`. Re-list with `applied: false` after each banka — a patch the',
      'banka found already applied is flagged by it and drops out of that list.',
    ].join('\n'),
    {
      brief: z.string().optional().describe('Brief path relative to the briefs root (.claude4spec/briefs). Omit for every brief.'),
      applied: z.boolean().optional().describe('Narrow to applied (true) or not yet applied (false). Omit for all.'),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        const rows = patches
          .listPatches({
            ...(typeof args.brief === 'string' ? { brief: args.brief } : {}),
            ...(typeof args.applied === 'boolean' ? { applied: args.applied } : {}),
          })
          .map((p) => ({
            path: p.path,
            title: p.title,
            brief: p.briefPath,
            patchKind: p.patchKind,
            applied: p.applied,
            createdAt: p.createdAt === '' ? null : p.createdAt,
          }));
        const page = paginate(
          rows,
          {
            limit: typeof args.limit === 'number' ? args.limit : undefined,
            offset: typeof args.offset === 'number' ? args.offset : undefined,
          },
          DEFAULT_LIMITS.listPatches,
        );
        return toolSuccess(
          {
            patches: page.items,
            total: page.total,
            hasMore: page.hasMore,
            ...(page.truncated ? { truncated: true } : {}),
          },
          { operation: 'list_patches', channel: 'internal', project: projectId },
        );
      } catch (err) {
        return toolFailure(err);
      }
    },
    { readOnlyHint: true },
  );
}

/**
 * 2.1.18 (M21 `01ytpznn`, M44 `3f5ej79s`) — `list_briefs`, the `internal`
 * rendering of the catalog row `list_briefs` (`internal: direct`), mounted only
 * where `transagent-tools` is: a top-level `chat` thread. Its input is the row's
 * (`implemented?`, `limit?`, `offset?`). The ORDER is the operation's own, the
 * release axis of `briefService.listBriefs` (M21 `0kz2u8g7`: newest cycle first,
 * unknown releases in the tail), computed before the `implemented` filter's
 * survivors are windowed; the WINDOW follows M39's implicit matrix (`total`
 * counted after the filter and before the slice, `hasMore`). `echo-free`: rows
 * carry the address, the window and the flag, never the brief's content.
 *
 * ASSUMPTION:dev-0007 — the default page size (50) is ours (M39 names none for
 * this list), and so is the row shape; the catalog class is `read`, not `brief`.
 */
function buildListBriefsTool(briefs: Pick<BriefService, 'listBriefs'>, projectId: string | null) {
  return mcpTool(
    'list_briefs',
    [
      'List the briefs of this specification — use it to turn a brief\'s name into its `path`',
      '(the `brief` filter of `list_patches`) and to orient yourself in the set. It is not an address',
      "for a banka: runTransagent({ contextType: 'brief' }) always founds a new brief.",
      'Ordered on the release axis: newest cycle first, a brief open to the current state directly',
      'above the briefs of the release it starts from, briefs of unknown releases last.',
      'Filter with `implemented` (`false` = not yet implemented).',
      'Each row: { path, title, fromRelease, toRelease, implemented, generatedAt } — no brief content.',
      'Paged: `limit` / `offset`, answered with `total` (counted after the filter) and `hasMore`.',
    ].join('\n'),
    {
      implemented: z.boolean().optional().describe('Narrow to implemented (true) or pending (false). Omit for all.'),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        const rows = briefs
          .listBriefs(typeof args.implemented === 'boolean' ? { implemented: args.implemented } : {})
          .map((b) => ({
            path: b.path,
            title: b.title,
            fromRelease: b.fromRelease,
            toRelease: b.toRelease,
            implemented: b.implemented,
            generatedAt: b.generatedAt === '' ? null : b.generatedAt,
          }));
        const page = paginate(
          rows,
          {
            limit: typeof args.limit === 'number' ? args.limit : undefined,
            offset: typeof args.offset === 'number' ? args.offset : undefined,
          },
          DEFAULT_LIMITS.listBriefs,
        );
        return toolSuccess(
          {
            briefs: page.items,
            total: page.total,
            hasMore: page.hasMore,
            ...(page.truncated ? { truncated: true } : {}),
          },
          { operation: 'list_briefs', channel: 'internal', project: projectId },
        );
      } catch (err) {
        return toolFailure(err);
      }
    },
    { readOnlyHint: true },
  );
}

/**
 * 2.1.18 (M10 `ww4lujgo` / `m10mcp00`) — `list_plans`, the plan set as the
 * orchestrator of a top-level chat thread reads it to pick a `planPath` for a
 * banka. Filters `applied` (a plan without the key counts as `false`); the
 * ORDER is `planService.listPlans({ order: 'created' })` — `created_at`
 * ascending, tie by `path` — not the `/plans` page's most-recently-changed
 * order; the WINDOW follows M39's implicit matrix (`limit` / `offset` with a
 * finite default, `total` before the slice, `hasMore`). A row carries no plan
 * content: only `get_plan` reads that, and only for the thread's own plan.
 *
 * ASSUMPTION:dev-0005 — no `list_plans` catalog row (Faza B pending at 2.1.18),
 * no `search` parameter (`search_plans` is `n/a`), and the default page size
 * (50) is ours — M39 names none for this list.
 */
function buildListPlansTool(plans: Pick<PlanService, 'listPlans'>, projectId: string | null) {
  return mcpTool(
    'list_plans',
    [
      'List the plans of this specification — the set you pick a plan from for a banka.',
      'Ordered by `created_at` ascending (ties by `path`; a plan without `created_at` comes last).',
      'Filter with `applied` (`false` = not yet applied to the spec; a plan with no `applied` field counts as false).',
      "Each row: { path, title, applied, createdAt, updatedAt } — no plan content; `path` is what",
      "runTransagent({ payload: { planPath } }) takes. Paged: `limit` / `offset`, answered with `total` and `hasMore`.",
    ].join('\n'),
    {
      applied: z.boolean().optional().describe('Narrow to applied (true) or not yet applied (false). Omit for all.'),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        const rows = plans
          .listPlans({
            order: 'created',
            ...(typeof args.applied === 'boolean' ? { applied: args.applied } : {}),
          })
          .map((p) => {
            const createdAt = toIso(p.frontmatter.created_at);
            return {
              path: p.path,
              title: p.title,
              applied: p.frontmatter.applied === true,
              createdAt: createdAt === '' ? null : createdAt,
              updatedAt: p.updatedAt === '' ? null : p.updatedAt,
            };
          });
        const page = paginate(
          rows,
          {
            limit: typeof args.limit === 'number' ? args.limit : undefined,
            offset: typeof args.offset === 'number' ? args.offset : undefined,
          },
          DEFAULT_LIMITS.listPlans,
        );
        return toolSuccess(
          {
            plans: page.items,
            total: page.total,
            hasMore: page.hasMore,
            ...(page.truncated ? { truncated: true } : {}),
          },
          { operation: 'list_plans', channel: 'internal', project: projectId },
        );
      } catch (err) {
        return toolFailure(err);
      }
    },
    { readOnlyHint: true },
  );
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
