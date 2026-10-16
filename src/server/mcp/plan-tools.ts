import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import type { PlanService } from '../services/plan.js';
import type { PlanSectionEdit } from '../services/plan-write.js';
import type { TextEdit } from '../services/text-edits.js';
import type { FileVersionService } from '../services/file-version.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';
import { DomainError } from '../services/tags.js';
import { addressingParam, artifactAddressingShape } from '../operations/addressing.js';

export interface PlanToolsContext {
  /**
   * The thread these tools address a plan through — on the `internal` mount the
   * ONLY address (2.1.13, M10 thread isolation: no `path` parameter exists there,
   * so the plan is always the one pinned to this thread).
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
   * names its `path`, and `update_plan` never creates. A new plan comes from
   * `create_plan` (0.2.98) on BOTH mounts — it founds its own carrier thread,
   * so it needs no thread from the caller. Same shape as `brief-tools`' `target`.
   */
  target?: 'thread' | 'explicit';
  planService: PlanService;
  /** 0.1.127: list_plan_versions/get_plan_version now read the shared M17
   *  file_version log (keyed rootId='plans') instead of the dropped
   *  `plan_version` table. */
  pageVersions: FileVersionService;
}


/**
 * 2.1.26 — `update_plan`'s description, the `plan-tools-update-plan` and
 * `plan-tools-update-plan-explicit` records' text verbatim: one text for both
 * mounts (the records carry the same one). Only the schema differs — the
 * threadless mount requires `path`.
 */
const UPDATE_PLAN_DESCRIPTION = [
  "Create or update the deployment plan attached to this thread.",
  "EXACTLY ONE of three variants per call, else INVALID_ARGUMENT: `content` — the complete markdown, create-or-replace; `textEdits` — literal find/replaceWith counted over the WHOLE plan; `edits` — a section batch by `anchor` (from get_plan), several actions per anchor.",
  "Batch actions: `replace` (OWN body), `append` (end of OWN body) and `insert_after` (after the subtree) take `content`; `delete` (subtree, heading, anchor) takes nothing; `edit` takes `textEdits`, counted inside the subtree alone; `rename` takes `heading`: the heading line alone, level and anchor kept. Wrong fields for an action, an invalid `rename` heading, or a `content` heading at or above the section's level in `replace`/`append`: INVALID_ARGUMENT for the whole batch. No `dropAnchors`, no ANCHOR_LOSS; each row's `droppedAnchors` names what went.",
  "The batch is TRANSACTIONAL and order-independent. `find` is matched on the plan as read. A `replace` carrying an existing subsection's anchor is INVALID_ARGUMENT. Anchors only: unknown → SECTION_NOT_FOUND, duplicated → AMBIGUOUS_ANCHOR.",
  "FIRST call in a thread: `title` REQUIRED (creates the file, slug immutable), else MISSING_TITLE; on an empty plan only `content` succeeds. Otherwise `expectedHash` is REQUIRED — the WHOLE plan's hash; missing → INVALID_ARGUMENT, stale → PLAN_CONFLICT (409) with the current hash. One `changeSummary`, one `file_version` entry per call.",
  "Returns { path, version, hash, results }: a row per element in input order, { anchor, action, affectedAnchors, droppedAnchors, replacements?, previousHeading? }; whole-plan variants: one row, null `anchor` and `action`. Content does not come back.",
  "IDEMPOTENT: `content`, `replace`, `rename` (not a `replace` adding a deeper heading). `delete` repeated → SECTION_NOT_FOUND, `edit`/`textEdits` → FIND_NOT_FOUND, `append`/`insert_after` duplicate.",
  "Use in plan_mode or when asked for a plan. It cannot change `applied` — use `mark_plan_applied`.",
].join('\n');

/** The `edits` parameter's description, both records' text verbatim. */
const UPDATE_PLAN_EDITS_DESCRIPTION =
  "VARIANT 3: a transactional section batch. Mutually exclusive with content and textEdits. replace — swap the section's OWN BODY; deeper headings in `content` become its first children, a heading at or above its level is INVALID_ARGUMENT. COLLISIONS — each element CLAIMS the plan as it was BEFORE the write: `delete` the subtree with its anchor line, `replace` the own body, `edit` each matched fragment, `rename` the anchor and heading lines; `append` and `insert_after` claim only a POINT. INVALID_ARGUMENT when two claims share a character or a point lies strictly INSIDE a claim (an edge is fine), for two elements of the SAME action on one anchor, and for ANY element addressing an anchor inside a deleted subtree. Inserts sharing a position land innermost first — `append` before `insert_after` of the same section, a descendant's before its ancestor's. `results[]` carries one row PER ELEMENT; read them by position.";

export function buildPlanToolsServer(
  ctx: PlanToolsContext,
  projectId: string | null = null,
): CapturedMcpServer {
  const { threadId, planService, pageVersions } = ctx;
  const explicit = ctx.target === 'explicit';
  /**
   * 2.1.13 — the plan's addressing parameter, shaped by M43's
   * `explicit-addressing` rule and NOT decided here. The threadless mount is an
   * external channel (`mcp`): `path` is required. The thread mount is `internal`,
   * where M10 declares thread isolation (`OWNER_THREAD_ISOLATION.plan`): `path`
   * is ABSENT, not optional — an agent sees and edits only the plan pinned to its
   * own thread, and an optional `path` would let it reach another thread's plan.
   */
  const pathParam = addressingParam(
    'path',
    artifactAddressingShape('plan', explicit ? 'mcp' : 'internal'),
    z.string().describe('Plan path relative to the plans root (.claude4spec/plans), from list_plans.'),
  );
  /**
   * 0.2.40 — the artifact read family's window, identical in shape to
   * `get_brief`'s and to `get_page.range`, and — like `get_brief`'s —
   * unconditionally allowed, because a plan never enters `section_index`.
   */
  /*
   * 2.1.26 — the bounds are NOT in the schema: `plan-tools-get-plan`'s logic
   * refuses a non-integer window, a start below 1 or an end before the start
   * with `INVALID_ARGUMENT` (`applyArtifactRange`), and a schema bound would
   * answer those with the transport's input-validation error instead of the code.
   * Same shape as `get_brief`'s window.
   */
  const rangeParam = {
    range: z
      .object({ start: z.number(), end: z.number() })
      .optional()
      .describe(
        '1-based inclusive line window { start, end } onto the plan. Always allowed. A start past the end of the file is refused with the file size.',
      ),
  };
  const requirePath = (raw: unknown): string => {
    if (typeof raw === 'string' && raw !== '') return raw;
    throw new DomainError(
      'INVALID_ARGUMENT',
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
  const ok = (data: unknown, operation: string) =>
    toolSuccess(data, { operation, channel: 'mcp', project: projectId });
  const fail = toolFailure;

  const getPlan = mcpTool(
    'get_plan',
    explicit
      ? 'Read a plan by path — latest content, version and hash. An unknown path is PLAN_NOT_FOUND; use list_plans to find one. The returned `hash` is what arms `expectedHash` on the next `update_plan`. For a long plan, or when a response comes back truncated, read it in windows with `range`.'
      : "Get the current plan for this thread — latest content, version and hash. Returns null when the thread has no plan yet. This is the ONLY way to the plan's content: the system prompt carries the plan's path and version, never its body. Use it to inspect plan state before updating, especially when a system reminder notes the plan was edited in another thread. The returned `hash` is what arms `expectedHash` on the next `update_plan`, so this read is the entry point of every write. For a long plan, or when a response comes back truncated, read it in windows with `range`.",
    { ...pathParam, ...rangeParam },
    async (args) => {
      try {
        const range = args.range as { start: number; end: number } | undefined;
        // Internal: the thread's pinned plan, or `plan: null` — nothing pinned is
        // a state of the thread, not a wrong address. External: PLAN_NOT_FOUND
        // for an unknown `path`, and only then.
        const plan = explicit
          ? await planService.getByAddress(requirePath(args.path), { range })
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
              'Anything else → MATCH_COUNT_MISMATCH, which answers with the real count and each hit as anchor + line.',
          ),
      }),
    )
    .min(1);

  /**
   * 0.2.98 — the direct way a plan is born: file + first version + a top-level
   * carrier thread, one call, no turn. No `threadId` and no `path` in the schema:
   * it is the one plan tool that does not address an existing plan, so it is
   * identical on the thread mount and the threadless one.
   */
  /**
   * 2.1.13 — a plan founded from a thread belongs to its CARRIER thread, not to
   * the calling one: the caller cannot address it with any other plan tool (the
   * internal mount has no `path`), and the returned address is for handing on,
   * not for its own edit. On the threadless mount every plan tool takes `path`,
   * so there the address is usable directly.
   */
  const createPlanDescription = explicit
    ? 'Create a new plan file from a title and a ready body, and get its address back. Use it when you already know what the plan should say — you have read the code and hold the content, not a question. The plan is created together with a carrier thread that grounds its provenance; no turn is started in that thread, so run one yourself if you want the plan worked on. The new plan belongs to its carrier thread. To edit it afterwards, pass the returned path to update_plan; the returned hash arms its expectedHash.'
    : 'Create a new plan file from a title and a ready body, and get its address back. Use it when you already know what the plan should say — you have read the code and hold the content, not a question. The plan is created together with a carrier thread that grounds its provenance; no turn is started in that thread, so run one yourself if you want the plan worked on. This is not how you edit a plan. The new plan belongs to its carrier thread, not to this one, so you cannot read or edit it from here — hand the returned path to whoever will work on it. To write the plan of this thread, use update_plan, with title on the first call.';
  const createPlan = mcpTool(
    'create_plan',
    createPlanDescription,
    {
      title: z
        .string()
        .describe(
          "Plan title. The plan's slug is derived from it once and is immutable afterwards, so renaming the title later does not move the plan. A title whose slug is already taken is refused rather than suffixed.",
        ),
      content: z
        .string()
        .optional()
        .describe('Full markdown body of the plan, verbatim — this is the first version. Blank or whitespace-only is refused: nothing is created.'),
    },
    async (args) => {
      try {
        const result = await planService.create({
          title: typeof args.title === 'string' ? args.title : '',
          ...(args.content !== undefined ? { content: String(args.content) } : {}),
          changedBy: 'agent',
        });
        return ok({ path: result.planPath, hash: result.hash, threads: result.threads }, 'create_plan');
      } catch (err) {
        return fail(err);
      }
    },
  );

  const updatePlan = mcpTool(
    'update_plan',
    UPDATE_PLAN_DESCRIPTION,
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
            action: z.enum(['replace', 'append', 'insert_after', 'delete', 'edit', 'rename']),
            content: z
              .string()
              .optional()
              .describe('Required for replace/append/insert_after. Forbidden for delete, edit and rename.'),
            textEdits: textEditsParam
              .optional()
              .describe('Required for action `edit`, forbidden for the other five. Counted inside this section\'s subtree only.'),
            heading: z
              .string()
              .optional()
              .describe(
                'Required for action `rename`, forbidden for the other five. The new heading as PLAIN TEXT — one ' +
                  'line, no leading `#` (the operation keeps the level it finds), no anchor comment, not empty once ' +
                  'trimmed; any of those four is INVALID_ARGUMENT for the whole batch.',
              ),
          }),
        )
        .min(1)
        .optional()
        .describe(UPDATE_PLAN_EDITS_DESCRIPTION),
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

  /**
   * 2.1.26 — `plan-tools-list-plans-explicit`, the `mcp` rendering of the
   * `list_plans` operation (its `internal` one is `transagent-tools · list_plans`).
   * ASSUMPTION:dev-2609 — built as the record states it (`search`, most recently
   * changed first, no window), although M10 `m10mcp00` gives the operation an
   * `applied` filter, `created_at` order and the M39 window.
   */
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
    explicit ? planService.getByAddress(requirePath(raw)) : planService.getByThread(threadId);

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
        const all = [...pageVersions.listVersions(plan.path, planService.rootId)].reverse();
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
      // 2.1.26 — `integer`, with no lower bound in the schema: a number off the
      // history (0 included) is the record's `INVALID_ARGUMENT` stating 1..N.
      version: z.number().int(),
    },
    async (args) => {
      try {
        // Only reachable in `thread` mode: `getByAddress` throws PLAN_NOT_FOUND
        // for an unknown path rather than answering null.
        const plan = await resolvePlan(args.path);
        // ASSUMPTION:dev-0002 — the row's codes are PLAN_NOT_FOUND (unknown
        // external path only) and INVALID_ARGUMENT: a thread with nothing pinned
        // and a version off the plan's axis are both INVALID_ARGUMENT.
        if (!plan) {
          return fail(
            new DomainError(
              'INVALID_ARGUMENT',
              'this thread has no plan, so it has no versions',
              'write the plan first with update_plan (title required on the first call)',
            ),
          );
        }
        const v = pageVersions.getVersion(plan.path, Number(args.version), planService.rootId);
        if (!v) {
          return fail(
            new DomainError(
              'INVALID_ARGUMENT',
              `version ${args.version} of plan '${plan.path}' does not exist — the plan has ${plan.currentVersion} version(s)`,
              plan.currentVersion > 0 ? `pass a version from 1 to ${plan.currentVersion}` : 'the plan has no versions yet',
            ),
          );
        }
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
   * Not gated by posture. `plan-tools` is an MCP server, and MCP sits entirely
   * outside the built-in deny-group gating, so the plan has no `contextType` of its own and
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
        // Internal: no `path` exists, so the thread's pinned plan is the only
        // target — nothing read off `args` can redirect it.
        return ok(
          await planService.setAppliedByThread(
            threadId,
            explicit
              ? { path: requirePath(args.path), applied: args.applied as boolean }
              : { applied: args.applied as boolean },
          ),
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
      createPlan,
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
