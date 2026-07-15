import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { PlanAction } from '../../shared/entities.js';
import type { PlanService } from '../services/plan.js';
import type { FileVersionService } from '../services/file-version.js';
import { PLAN_ROOT_MARKER } from '../../shared/types.js';
import { DomainError } from '../services/tags.js';

export interface PlanToolsContext {
  threadId: string;
  planService: PlanService;
  /** 0.1.127: list_plan_versions/get_plan_version now read the shared M17
   *  file_version log (keyed rootId='plan') instead of the dropped
   *  `plan_version` table. */
  pageVersions: FileVersionService;
}

const AGENT_ACTIONS = z.enum(['replace', 'append', 'insert_after_section']);

export function buildPlanToolsServer(ctx: PlanToolsContext): McpServerInstance {
  const { threadId, planService, pageVersions } = ctx;

  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });
  const fail = (err: unknown) => {
    const code = err instanceof DomainError ? err.code : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message, code }) }],
      isError: true,
    };
  };

  const getPlan = mcpTool(
    'get_plan',
    'Get the current plan attached to this thread (latest content, version). Returns { plan: null } if the thread has no plan yet. Use to inspect plan state before updating.',
    {},
    async () => {
      try {
        const plan = await planService.getByThread(threadId);
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
      '- insert_after_section: insert a fragment after a target section (body of that section ends before the next heading of equal/higher level). Requires `anchor` or `heading`.',
      'Section anchors (nanoid-8 HTML comments) are auto-injected into new headings before persisting.',
      'On the FIRST call in a thread (no plan attached yet), `title` is REQUIRED — it creates the plan file (slug = slugify(title), immutable — a later title change edits frontmatter only, it never renames the file). Omitting `title` on the first call fails with MISSING_TITLE.',
      'Each call captures a new version in the shared file_version log and bumps `currentVersion`. Versions are linear, last-write-wins.',
      'Available in plan_mode=true (preferred) and plan_mode=false.',
    ].join('\n'),
    {
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

  const listPlanVersions = mcpTool(
    'list_plan_versions',
    "List all versions of this thread's plan (metadata only, no full content). Use for audit / timeline rendering or before calling get_plan_version.",
    {
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    async (args) => {
      try {
        const plan = await planService.getByThread(threadId);
        if (!plan) return ok({ versions: [], total: 0 });
        const all = pageVersions.listVersions(plan.path, PLAN_ROOT_MARKER);
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
      version: z.number().int().positive(),
    },
    async (args) => {
      try {
        const plan = await planService.getByThread(threadId);
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
    tools: [getPlan, updatePlan, listPlanVersions, getPlanVersion],
  });
}
