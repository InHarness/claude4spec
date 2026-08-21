import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import type { PlanService } from '../services/plan.js';
import type { PlanSectionEdit } from '../services/plan-write.js';
import type { TextEdit } from '../services/text-edits.js';
import type { FileVersionService } from '../services/file-version.js';
import { PLAN_ROOT_MARKER } from '../../shared/types.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';

export interface PlanToolsContext {
  /**
   * The thread these tools address a plan through — the `internal` channel's
   * default binding.
   *
   * On a channel that HAS no thread, pass `target: 'explicit'` instead of
   * inventing an id. A synthetic `threadId` resolves to no plan, so every
   * `update_plan` took the create branch, wrote a file, and then threw
   * NOT_FOUND attaching it to a thread that does not exist — leaving an orphan
   * plan (and a version row) behind on every attempt, forever, since retrying
   * just allocates the next free slug.
   */
  threadId: string;
  /**
   * 0.2.13 — how a plan is addressed on this mount.
   *
   * `'thread'` (default) is the internal channel: the plan is the one bound to
   * `threadId`, and the first update in a thread with no plan CREATES it.
   * `'explicit'` is a threadless channel (the external MCP mount): every call
   * names its `path`, and creation is unavailable — §7 says a plan is born only
   * from a thread, so a channel with no thread edits plans and does not mint
   * them. Same shape as `brief-tools`' `target`.
   */
  target?: 'thread' | 'explicit';
  planService: PlanService;
  /** 0.1.127: list_plan_versions/get_plan_version now read the shared M17
   *  file_version log (keyed rootId='plan') instead of the dropped
   *  `plan_version` table. */
  pageVersions: FileVersionService;
}


export function buildPlanToolsServer(ctx: PlanToolsContext): CapturedMcpServer {
  const { threadId, planService, pageVersions } = ctx;
  const explicit = ctx.target === 'explicit';
  /** `path` is required exactly when there is no thread to default it from. */
  const pathParam = explicit
    ? { path: z.string().describe('Plan path relative to plansDir, from list_plans.') }
    : {};
  /**
   * 0.2.40 — the artifact read family's window, identical in shape to
   * `get_brief`'s and to `get_page.range`, and — like `get_brief`'s —
   * unconditionally allowed, because a plan never enters `section_index`.
   */
  const rangeParam = {
    range: z
      .object({ start: z.number().int().positive(), end: z.number().int().positive() })
      .optional()
      .describe(
        '1-based inclusive line window onto the plan. Always allowed. A `start` past the end of the file is INVALID_ARGUMENT stating the file size.',
      ),
  };
  const requirePath = (raw: unknown): string => {
    if (typeof raw === 'string' && raw !== '') return raw;
    throw new DomainError(
      'VALIDATION',
      'path is required on this connection — there is no thread to take the plan from',
      'list the plans with list_plans, then pass one of their paths',
    );
  };

  /**
   * The shared envelope. The local `fail` this replaces dropped `hint` — so
   * every refusal from here answered with a code and no repair path, including
   * the `VALIDATION` above whose hint is the only thing that tells a caller to
   * run `list_plans` first.
   */
  const ok = (data: unknown, operation: string) => toolSuccess(data, { operation, channel: 'mcp' });
  const fail = toolFailure;

  const getPlan = mcpTool(
    'get_plan',
    explicit
      ? 'Read a plan by path (latest content, version). Use list_plans to find one.'
      : 'Get the current plan attached to this thread (latest content, version). Returns { plan: null } if the thread has no plan yet. Use to inspect plan state before updating.',
    { ...pathParam, ...rangeParam },
    async (args) => {
      try {
        const range = args.range as { start: number; end: number } | undefined;
        const plan = explicit
          ? await planService.getByPath(requirePath(args.path), { range })
          : await planService.getByThread(threadId, { range });
        if (!plan) return ok({ plan: null }, 'get_plan');
        return ok({
          plan: {
            path: plan.path,
            title: plan.frontmatter.title,
            content: plan.body,
            applied: plan.frontmatter.applied ?? false,
            currentVersion: plan.currentVersion,
            /**
             * 0.2.15 — `hash` is here because `update_plan` now REQUIRES it, and
             * this is the only way to obtain one before the first edit of a
             * session. A read operation that cannot arm the write operation's
             * guard leaves the caller no legal first move.
             */
            hash: plan.hash,
            createdAt: plan.createdAt,
            updatedAt: plan.updatedAt,
            ...(plan.truncated
              ? { truncated: plan.truncated, truncationHint: plan.truncationHint }
              : {}),
          },
        }, 'get_plan');
      } catch (err) {
        return fail(err);
      }
    }
  );

  /**
   * 0.2.43 — the differential payload, described in the SAME words as
   * `page-tools`' `textEditsParam`. Two descriptions of one contract is how the
   * channels used to drift, and the whole reason this shape was copied from the
   * page tools is that an agent should not have to learn a second edit grammar.
   */
  const textEditsParam = z
    .array(
      z.object({
        find: z
          .string()
          .describe(
            'Searched LITERALLY, byte for byte — no regex, no whitespace normalization. ' +
              'Copy it out of what you just read. Zero hits → FIND_NOT_FOUND, whose envelope tells you ' +
              'whether the pattern would have matched with whitespace collapsed (it usually would: ' +
              'mis-transcribed indentation is the common cause).',
          ),
        replaceWith: z.string().describe('Inserted in place of every hit. "" deletes the matched text.'),
        expectedMatches: z
          .union([z.number().int().min(1), z.literal('all')])
          .optional()
          .describe(
            'How many hits you expect. OMITTING IT MEANS EXACTLY 1 — not "any number". ' +
              'Pass "all" to substitute every occurrence without committing to a count. ' +
              'Anything else → MATCH_COUNT_MISMATCH, which answers with the real count and each hit as line.',
          ),
      }),
    )
    .min(1);

  const updatePlan = mcpTool(
    'update_plan',
    [
      'Create or update the deployment plan attached to this thread.',
      'THREE INPUT VARIANTS, EXACTLY ONE PER CALL. More than one, or none, is INVALID_ARGUMENT.',
      '- `content`: the complete plan markdown. The create-or-replace primitive — this is what writes a plan that does not exist yet.',
      '- `textEdits`: literal find/replaceWith substitutions counted over the WHOLE plan.',
      '- `edits`: a section batch, one entry per section, addressed by `anchor` (from get_plan).',
      'Batch actions: `replace` / `append` / `insert_after` take `content`; `delete` takes neither; `edit` takes `textEdits` — literal substitutions inside the addressed subtree ALONE, which is where its match counts differ from the top-level variant\'s.',
      'A SECTION IS ITS SUBTREE. `replace` on a `##` carrying three `###` rewrites all four; `delete` removes all four with their anchors. The `droppedAnchors` of each result row names what went, on success as well as on refusal.',
      'The batch is TRANSACTIONAL and its ORDER DOES NOT MATTER: entries are applied bottom-up whatever order you send, one rejected entry means nothing at all is written (no version, no event), and two orderings of the same batch produce identical text. A repeated anchor is INVALID_ARGUMENT — one `edit` entry carries a LIST of substitutions, so a second entry is never the way to ask for a second one. An `edit` inside a section this same batch replaces or deletes is INVALID_ARGUMENT too.',
      'Sections are addressed by ANCHOR ONLY. `heading` is gone: an unknown anchor is SECTION_NOT_FOUND with no append-at-end fallback, and an anchor duplicated inside the plan is AMBIGUOUS_ANCHOR.',
      'On the FIRST call in a thread (no plan attached yet), `title` is REQUIRED — it creates the plan file (slug = slugify(title), immutable — a later title change edits frontmatter only, it never renames the file). Omitting `title` fails MISSING_TITLE in every variant, before any anchor is resolved. On an empty plan only `content` can succeed: `edits` answers SECTION_NOT_FOUND and `textEdits` FIND_NOT_FOUND, and neither leaves a plan file behind.',
      '`expectedHash` is REQUIRED on every call EXCEPT that first, creating one: pass the `hash` from get_plan or from your previous update_plan. It is the hash of the WHOLE plan in all three variants, a batch touching one section included. Omitting it fails INVALID_ARGUMENT; a stale value fails PLAN_CONFLICT (409) carrying the current hash. A plan has several concurrent writers (this thread, the UI, an attach), so a write without the guard silently drops someone else\'s edit.',
      '`changeSummary` is ONE per call, however many edits the call carries — and so is the `file_version` entry.',
      'Returns { path, version, hash, results } — the hash arms your next call. Each `results` row is { anchor, action, affectedAnchors, droppedAnchors, replacements? }, in the order you GAVE the edits, not the order they were applied; `replacements` appears only where a literal match ran. Whole-plan variants answer with one row whose `anchor` and `action` are null. The plan content does not come back; you already have it.',
      'IDEMPOTENCE: `content` and a batch `replace` repeat harmlessly (same text, new version number). `delete` repeated answers SECTION_NOT_FOUND, `edit`/`textEdits` answer FIND_NOT_FOUND, and `append`/`insert_after` duplicate their content.',
      'Available in plan_mode=true (preferred) and plan_mode=false.',
      'This tool cannot change `applied` — use `mark_plan_applied`.',
    ].join('\n'),
    {
      ...pathParam,
      content: z
        .string()
        .optional()
        .describe('VARIANT 1: the complete plan markdown. Mutually exclusive with textEdits and edits.'),
      textEdits: textEditsParam
        .optional()
        .describe('VARIANT 2: substitutions counted over the whole plan. Mutually exclusive with content and edits.'),
      edits: z
        .array(
          z.object({
            anchor: z.string().describe('From get_plan. The only way to address a section — `heading` no longer exists.'),
            action: z.enum(['replace', 'append', 'insert_after', 'delete', 'edit']),
            content: z
              .string()
              .optional()
              .describe('Required for replace/append/insert_after. Forbidden for delete and edit.'),
            textEdits: textEditsParam
              .optional()
              .describe('Required for action `edit`, forbidden for the other four. Counted inside this section\'s subtree only.'),
          }),
        )
        .min(1)
        .optional()
        .describe('VARIANT 3: a transactional section batch. Mutually exclusive with content and textEdits.'),
      title: z.string().optional(),
      /**
       * Optional in the SCHEMA, required by the OPERATION on every call but the
       * first. The exemption is real (a plan being created has nothing to be
       * stale against) and cannot be expressed in a zod shape, so the check
       * lives in `PlanService.update` where it applies to every channel.
       */
      expectedHash: z
        .string()
        .optional()
        .describe(
          'sha256 of the plan as you last read it (`hash` from get_plan or a previous update_plan). ' +
            'REQUIRED except on the first call in a thread, which creates the plan.',
        ),
      changeSummary: z.string(),
    },
    async (args) => {
      try {
        const result = await planService.update({
          threadId,
          ...(explicit ? { planPath: requirePath(args.path) } : {}),
          /**
           * Forwarded only when PRESENT. Defaulting any of the three would make
           * every call carry two variants and refuse itself — "exactly one" is a
           * property of what the caller sent, so an absent field has to stay
           * absent all the way to the validator.
           */
          ...(args.content !== undefined ? { content: String(args.content) } : {}),
          ...(args.textEdits !== undefined ? { textEdits: args.textEdits as TextEdit[] } : {}),
          ...(args.edits !== undefined ? { edits: args.edits as PlanSectionEdit[] } : {}),
          title: typeof args.title === 'string' ? args.title : undefined,
          expectedHash: typeof args.expectedHash === 'string' ? args.expectedHash : undefined,
          changeSummary: String(args.changeSummary ?? ''),
          changedBy: 'agent',
        });
        /**
         * 0.2.15 (echo-free) — the address of the effect, the timeline, and the
         * one unpredictable delta. 0.2.43 adds `results`, which is the rest of
         * that delta: which anchors moved and which ones the write took with it.
         */
        return ok({
          path: result.plan.path,
          version: result.version,
          hash: result.hash,
          results: result.results,
        }, 'update_plan');
      } catch (err) {
        return fail(err);
      }
    }
  );

  const listPlans = mcpTool(
    'list_plans',
    'List the plans in this project — path, title, last update. The path is what get_plan / update_plan take on this connection.',
    { search: z.string().optional().describe('Filter by title or path substring.') },
    async (args) => {
      try {
        return ok({
          plans: planService
            .listPlans(typeof args.search === 'string' ? { search: args.search } : {})
            .map((p) => ({ path: p.path, title: p.title, updatedAt: p.updatedAt })),
        }, 'list_plans');
      } catch (err) {
        return fail(err);
      }
    },
  );

  /**
   * The plan these tools act on, by whichever means this mount addresses one.
   *
   * Factored out because the first pass at `target: 'explicit'` gave `path` to
   * `get_plan`/`update_plan` and left the two version tools calling
   * `getByThread` — on a mount whose `threadId` is the literal `'mcp-external'`,
   * which matches no `chat_thread` row. They did not fail loudly: `list_plan_versions`
   * answered `{ versions: [], total: 0 }` for a plan with a hundred versions, and
   * neither tool exposed a `path`, so no input could make them work. A half-applied
   * addressing mode is worse than none, because the half that still compiles is the
   * half that answers confidently.
   */
  const resolvePlan = async (raw: unknown) =>
    explicit ? planService.getByPath(requirePath(raw)) : planService.getByThread(threadId);

  const listPlanVersions = mcpTool(
    'list_plan_versions',
    explicit
      ? 'List all versions of a plan (metadata only, no full content), oldest first — offset 0 is version 1. Use for audit / timeline rendering or before calling get_plan_version.'
      : "List all versions of this thread's plan (metadata only, no full content), oldest first — offset 0 is version 1. Use for audit / timeline rendering or before calling get_plan_version.",
    {
      ...pathParam,
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        const plan = await resolvePlan(args.path);
        if (!plan) return ok({ versions: [], total: 0 }, 'list_plan_versions');
        // FileVersionService.listVersions returns newest-first (shared with
        // brief/patch/the client's version-history view) — reverse to
        // oldest-first here so this tool's offset/limit contract (offset 0 =
        // version 1, increasing offset walks forward in time) stays what it
        // was under the old plan_version-table-backed implementation.
        const all = [...pageVersions.listVersions(plan.path, PLAN_ROOT_MARKER)].reverse();
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        const limit = typeof args.limit === 'number' ? args.limit : all.length;
        return ok({ versions: all.slice(offset, offset + limit), total: all.length }, 'list_plan_versions');
      } catch (err) {
        return fail(err);
      }
    }
  );

  const getPlanVersion = mcpTool(
    'get_plan_version',
    'Get a specific version snapshot with full content. Use to inspect historical plan state or prepare a diff locally.',
    {
      ...pathParam,
      version: z.number().int().positive(),
    },
    async (args) => {
      try {
        // Only reachable in `thread` mode: `getByPath` throws NOT_FOUND for an
        // unknown path rather than answering null, which is the better refusal
        // and already carries the path the caller got wrong.
        const plan = await resolvePlan(args.path);
        if (!plan) {
          return fail(new DomainError('VERSION_NOT_FOUND', 'thread has no plan'));
        }
        const v = pageVersions.getVersion(plan.path, Number(args.version), PLAN_ROOT_MARKER);
        if (!v) return fail(new DomainError('VERSION_NOT_FOUND', `version ${args.version} not found`));
        return ok(v, 'get_plan_version');
      } catch (err) {
        return fail(err);
      }
    }
  );

  /**
   * 0.2.14 — the plan's agent channel for its execution flag.
   *
   * Separate from `update_plan` on purpose: writing a plan's content and
   * declaring it applied are different acts with different undo directions,
   * so `applied` is deliberately absent from `update_plan`'s shape and editing
   * a plan can never flip the flag as a side effect.
   *
   * Not gated by posture. `plan-tools` is outside the READONLY_BUILTINS /
   * MUTATING_BUILTINS filter and the plan has no `contextType` of its own, so
   * this is reachable regardless of `chat_thread.plan_mode` — a recorded
   * decision, not an oversight. The contrast is `mark-brief-implemented`, which
   * declares a fact about CODE that a C4S thread cannot see; a plan declares a
   * fact about the SPECIFICATION, and the agent that just ran the plan is the
   * only party in a position to state it.
   */
  const markPlanApplied = mcpTool(
    'mark_plan_applied',
    [
      "Mark this thread's plan as applied to the specification. Call it as the LAST step after you have finished executing the plan.",
      'One-way from here: `applied: false` is refused (INVALID_ARGUMENT) — only the user unsets the flag, from the plan page.',
      'Idempotent: calling it again with the same value changes nothing.',
    ].join('\n'),
    {
      ...pathParam,
      applied: z.boolean().describe('Must be true — this tool marks a plan applied, it does not unmark one.'),
    },
    async (args) => {
      try {
        const explicitPath = explicit ? requirePath(args.path) : (args.path as string | undefined);
        return ok(
          await planService.setAppliedByThread(threadId, {
            path: explicitPath,
            applied: args.applied as boolean,
          }),
          'mark_plan_applied',
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  return createMcpServer({
    name: 'plan-tools',
    tools: [
      getPlan,
      updatePlan,
      listPlanVersions,
      getPlanVersion,
      markPlanApplied,
      /**
       * Only on the threadless mount, and not for symmetry: without it `path`
       * is a required parameter with no operation that can produce a value for
       * it, which is the same unreachable-contract shape as an `expectedHash`
       * no read returns. In `thread` mode the plan is implicit and listing every
       * plan in the project would widen the internal surface for nothing.
       */
      ...(explicit ? [listPlans] : []),
    ],
  });
}
