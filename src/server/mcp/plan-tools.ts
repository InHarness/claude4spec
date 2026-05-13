import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { PlanAction } from '../../shared/entities.js';
import type { PlanService } from '../services/plan.js';
import { DomainError } from '../services/tags.js';

export interface PlanToolsContext {
  threadId: string;
  planService: PlanService;
}

const AGENT_ACTIONS = z.enum(['replace', 'append', 'insert_after_section']);

export function buildPlanToolsServer(ctx: PlanToolsContext): McpServerInstance {
  const { threadId, planService } = ctx;

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
    'Get the current plan attached to this thread (latest content, version). Returns { plan: null } if the thread has no plan yet. Use to inspect plan state before updating — especially when a <system-reminder> notes the plan was edited in another thread.',
    {},
    async () => {
      try {
        const plan = planService.getByThread(threadId);
        if (plan) planService.markPlanSeenByThread(threadId);
        return ok({ plan });
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
      'Each call creates an immutable snapshot in plan_version and bumps current_version GLOBALLY for the plan (model N:1 — versions are linear, last-write-wins; if another thread bumped the plan since you last saw it, the user message that triggered this turn will contain a <system-reminder> noting the new version — call get_plan first to refresh).',
      'On first call in a thread without a plan, this upserts a new plan and attaches it to the thread.',
      'Available in plan_mode=true (preferred) and plan_mode=false.',
    ].join('\n'),
    {
      action: AGENT_ACTIONS,
      content: z.string(),
      anchor: z.string().optional(),
      heading: z.string().optional(),
      changeSummary: z.string(),
    },
    async (args) => {
      try {
        const action = args.action as PlanAction;
        const result = planService.update({
          threadId,
          action,
          content: String(args.content ?? ''),
          anchor: typeof args.anchor === 'string' ? args.anchor : undefined,
          heading: typeof args.heading === 'string' ? args.heading : undefined,
          changeSummary: String(args.changeSummary ?? ''),
          changedBy: 'agent',
        });
        return ok({
          planId: result.plan.id,
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
        const plan = planService.getByThread(threadId);
        if (!plan) return ok({ versions: [], total: 0 });
        const result = planService.listVersions(plan.id, {
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          offset: typeof args.offset === 'number' ? args.offset : undefined,
        });
        return ok(result);
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
        const plan = planService.getByThread(threadId);
        if (!plan) {
          return fail(new DomainError('VERSION_NOT_FOUND', 'thread has no plan'));
        }
        const v = planService.getVersion(plan.id, Number(args.version));
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
