import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import { z } from 'zod';
import type { PlanAction } from '../../shared/entities.js';
import type { PlanService } from '../services/plan.js';
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

const AGENT_ACTIONS = z.enum(['replace', 'append', 'insert_after_section']);

export function buildPlanToolsServer(ctx: PlanToolsContext): CapturedMcpServer {
  const { threadId, planService, pageVersions } = ctx;
  const explicit = ctx.target === 'explicit';
  /** `path` is required exactly when there is no thread to default it from. */
  const pathParam = explicit
    ? { path: z.string().describe('Plan path relative to plansDir, from list_plans.') }
    : {};
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
  const ok = toolSuccess;
  const fail = toolFailure;

  const getPlan = mcpTool(
    'get_plan',
    explicit
      ? 'Read a plan by path (latest content, version). Use list_plans to find one.'
      : 'Get the current plan attached to this thread (latest content, version). Returns { plan: null } if the thread has no plan yet. Use to inspect plan state before updating.',
    pathParam,
    async (args) => {
      try {
        const plan = explicit
          ? await planService.getByPath(requirePath(args.path))
          : await planService.getByThread(threadId);
        if (!plan) return ok({ plan: null });
        return ok({
          plan: {
            path: plan.path,
            title: plan.frontmatter.title,
            content: plan.body,
            currentVersion: plan.currentVersion,
            createdAt: plan.createdAt,
            updatedAt: plan.updatedAt,
          },
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const updatePlan = mcpTool(
    'update_plan',
    [
      'Create or update the deployment plan attached to this thread.',
      'Hybrid write tool with three actions:',
      '- replace: full rewrite of the plan (provide full markdown in `content`).',
      '- append: append a fragment at the end of the plan (separator added automatically).',
      '- insert_after_section: insert a fragment after a target section (body of that section ends before the next heading of equal/higher level). Requires `anchor` or `heading`. Fails with SECTION_NOT_FOUND when the target matches nothing, AMBIGUOUS_HEADING when a `heading` matches several sections, and AMBIGUOUS_ANCHOR when an `anchor` does — an anchor names exactly one section, so a duplicate is a defect to fix in the plan, not a target to guess at.',
      'Section anchors (nanoid-8 HTML comments) are auto-injected into new headings before persisting, unique within THIS plan file — a plan anchor equal to some page section anchor is not a collision, because the two live in separate stores and are resolved separately. A duplicate anchor pasted in by hand does not block the write; it only makes insert_after_section against it ambiguous.',
      'On the FIRST call in a thread (no plan attached yet), `title` is REQUIRED — it creates the plan file (slug = slugify(title), immutable — a later title change edits frontmatter only, it never renames the file). Omitting `title` on the first call fails with MISSING_TITLE.',
      'Each call captures a new version in the shared file_version log and bumps `currentVersion`. Versions are linear, last-write-wins.',
      'Available in plan_mode=true (preferred) and plan_mode=false.',
    ].join('\n'),
    {
      ...pathParam,
      action: AGENT_ACTIONS,
      content: z.string(),
      anchor: z.string().optional(),
      heading: z.string().optional(),
      title: z.string().optional(),
      changeSummary: z.string(),
    },
    async (args) => {
      try {
        const action = args.action as PlanAction;
        const result = await planService.update({
          threadId,
          ...(explicit ? { planPath: requirePath(args.path) } : {}),
          action,
          content: String(args.content ?? ''),
          anchor: typeof args.anchor === 'string' ? args.anchor : undefined,
          heading: typeof args.heading === 'string' ? args.heading : undefined,
          title: typeof args.title === 'string' ? args.title : undefined,
          changeSummary: String(args.changeSummary ?? ''),
          changedBy: 'agent',
        });
        return ok({
          planPath: result.plan.path,
          version: result.version,
          currentVersion: result.plan.currentVersion,
        });
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
        });
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
        if (!plan) return ok({ versions: [], total: 0 });
        // FileVersionService.listVersions returns newest-first (shared with
        // brief/patch/the client's version-history view) — reverse to
        // oldest-first here so this tool's offset/limit contract (offset 0 =
        // version 1, increasing offset walks forward in time) stays what it
        // was under the old plan_version-table-backed implementation.
        const all = [...pageVersions.listVersions(plan.path, PLAN_ROOT_MARKER)].reverse();
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        const limit = typeof args.limit === 'number' ? args.limit : all.length;
        return ok({ versions: all.slice(offset, offset + limit), total: all.length });
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
        return ok(v);
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
