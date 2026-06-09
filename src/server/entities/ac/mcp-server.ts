import {
  createMcpServer,
  mcpTool,
  type McpServerInstance,
} from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import type { AcService } from './services.js';
import { AcAnalysisService } from './ac-analysis.service.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsGateway } from '../../ws/gateway.js';
import type { PluginHost } from '../../core/plugin-host/types.js';
import { DomainError } from '../../services/tags.js';
import type {
  AcKind,
  AcStatus,
  AcVerifyRef,
} from '../../../shared/entities.js';

export interface AcToolsDeps {
  acService: AcService;
  referencesService: ReferencesService;
  ws: WsGateway;
  /** M19→AC: needed to hydrate verified-entity snapshots for the LLM audit. */
  db: Database;
  /** M19→AC: project root for the LLM adapter. */
  cwd: string;
  /** Brief 0.1.45 §1: inactive guard for the semantic audit. */
  host: PluginHost;
}

export function createAcToolsServer(deps: AcToolsDeps): McpServerInstance {
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

  const verifyRefSchema = z.object({
    type: z.string().describe('Entity type (endpoint, dto, database-table, ui-view, ...)'),
    slug: z.string(),
  });

  const createAc = mcpTool(
    'create_ac',
    'Create a new acceptance criterion. Slug is auto-generated from the first ~40 chars of `text` (prefixed with "ac-"). Use `verifies` to link the AC to specific entities; missing entities are reported as warnings but do not block save.',
    {
      text: z.string().describe('Observable behavior the AC asserts. One sentence is best.'),
      kind: z
        .enum(['requirement', 'edge-case'])
        .optional()
        .describe('requirement (default) | edge-case'),
      status: z.enum(['active', 'deprecated']).optional(),
      verifies: z
        .array(verifyRefSchema)
        .optional()
        .describe('Entities this AC verifies. Reported broken if entity does not exist; not blocking.'),
      description: z.string().optional(),
      slug: z.string().optional().describe('Optional explicit slug; otherwise auto-generated.'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Tag slugs. Convention: m07 for module M07, entity-dto for DTO entity, etc.'),
    },
    async (args) => {
      try {
        const ac = deps.acService.create(
          {
            text: String(args.text),
            kind: args.kind as AcKind | undefined,
            status: args.status as AcStatus | undefined,
            verifies: args.verifies as AcVerifyRef[] | undefined,
            description: args.description as string | null | undefined,
            slug: args.slug as string | undefined,
            tags: args.tags as string[] | undefined,
          },
          'agent',
        );
        const broken = ac.verifies.length ? deps.acService.classifyVerifies(ac.verifies) : [];
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'ac', slug: ac.slug });
        return ok({ id: ac.slug, slug: ac.slug, type: 'ac', brokenVerifies: broken });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const getAc = mcpTool(
    'get_ac',
    'Get full details of an AC by slug. Returns text, kind, status, verifies (with broken-flag), tags, and description.',
    { slug: z.string() },
    async (args) => {
      const ac = deps.acService.getBySlug(String(args.slug));
      if (!ac) return fail(new DomainError('NOT_FOUND', `ac '${args.slug}' not found`));
      const broken = ac.verifies.length ? deps.acService.classifyVerifies(ac.verifies) : [];
      return ok({ ...ac, brokenVerifies: broken });
    },
  );

  const updateAc = mcpTool(
    'update_ac',
    'Update an AC (partial). Only provided fields change. Use newSlug for explicit rename — propagates references in pages. Prefer status="deprecated" over delete to preserve history.',
    {
      slug: z.string(),
      data: z
        .object({
          text: z.string().optional(),
          kind: z.enum(['requirement', 'edge-case']).optional(),
          status: z.enum(['active', 'deprecated']).optional(),
          verifies: z.array(verifyRefSchema).optional(),
          description: z.string().nullable().optional(),
          tags: z.array(z.string()).optional(),
        })
        .describe('Partial fields to update'),
      newSlug: z
        .string()
        .optional()
        .describe(
          'Explicit slug rename. The slug is not re-generated automatically when text changes.'
        ),
    },
    async (args) => {
      try {
        const data = args.data as Record<string, unknown>;
        const { ac, previousSlug } = deps.acService.update(
          String(args.slug),
          {
            text: data.text as string | undefined,
            kind: data.kind as AcKind | undefined,
            status: data.status as AcStatus | undefined,
            verifies: data.verifies as AcVerifyRef[] | undefined,
            description: data.description as string | null | undefined,
            tags: data.tags as string[] | undefined,
            newSlug: args.newSlug as string | undefined,
          },
          'agent',
        );
        if (ac.slug !== previousSlug) {
          await deps.referencesService.propagateSlugChange('ac', previousSlug, ac.slug);
        }
        const broken = ac.verifies.length ? deps.acService.classifyVerifies(ac.verifies) : [];
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'ac', slug: ac.slug });
        return ok({ slug: ac.slug, updated: true, brokenVerifies: broken });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const deleteAc = mcpTool(
    'delete_ac',
    'Hard-delete an AC. Returns list of pages with broken references. Prefer update_ac { status: "deprecated" } as soft delete to keep history.',
    { slug: z.string() },
    async (args) => {
      try {
        const slug = String(args.slug);
        const refs = await deps.referencesService.findReferences('ac', slug);
        deps.acService.remove(slug, 'agent');
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'ac', slug });
        return ok({
          deleted: true,
          brokenReferences: refs.map((r) => ({ pagePath: r.pagePath, count: 1 })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const listAcs = mcpTool(
    'list_acs',
    'List acceptance criteria with optional filtering by status, kind, tags, or search text. Default status filter is "active" — pass status="all" to include deprecated.',
    {
      status: z.enum(['active', 'deprecated', 'all']).optional(),
      kind: z.enum(['requirement', 'edge-case']).optional(),
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const list = deps.acService.list({
          status: args.status as AcStatus | 'all' | undefined,
          kind: args.kind as AcKind | undefined,
          tags: args.tags as string[] | undefined,
          tagFilter: args.tagFilter as 'and' | 'or' | undefined,
          search: args.search as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        return ok({
          acs: list.map((a) => ({
            slug: a.slug,
            text: a.text,
            kind: a.kind,
            status: a.status,
            tags: a.tags,
            verifyCount: a.verifies.length,
          })),
          total: list.length,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const analysisService = new AcAnalysisService({
    acService: deps.acService,
    db: deps.db,
    cwd: deps.cwd,
    host: deps.host,
  });

  const analyzeAcAgainstEntities = mcpTool(
    'analyze_ac_against_entities',
    'LLM-based on-demand semantic check: for each active AC, load its `text` + `verifies[]` + the linked entity snapshots and ask the model whether the AC text matches the shape of those entities. Non-deterministic and expensive — call deliberately, not in a loop. Distinct from `check_consistency` (which is deterministic and structural). Output: { issues: [{ ac_slug, issue_type, details, affected_entity?, confidence, suggested_correction? }], analyzed_count, skipped_count, skipped_reasons }.',
    {
      scope_tag: z
        .string()
        .optional()
        .describe('Limit analysis to active ACs carrying this tag slug. Omit for all active ACs.'),
      ac_slug: z
        .string()
        .optional()
        .describe('Limit analysis to a single AC by slug. Omit to analyse all active ACs.'),
    },
    async (args) => {
      try {
        const result = await analysisService.analyze({
          scope_tag: args.scope_tag as string | undefined,
          ac_slug: args.ac_slug as string | undefined,
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'ac-tools',
    tools: [createAc, getAc, updateAc, deleteAc, listAcs, analyzeAcAgainstEntities],
  });
}
