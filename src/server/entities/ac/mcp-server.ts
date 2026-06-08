import {
  createAdapter,
  createMcpServer,
  extractText,
  mcpTool,
  type McpServerInstance,
} from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import type { AcService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsGateway } from '../../ws/gateway.js';
import { DomainError } from '../../services/tags.js';
import {
  RawEntityReader,
  isRawEntityType,
  type RawEntityType,
} from '../../domain/raw-entity-reader.js';
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
      newSlug: z.string().optional(),
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

  const analyzeAcAgainstEntities = mcpTool(
    'analyze_ac_against_entities',
    'LLM-based on-demand semantic check: for each active AC, load its `text` + `verifies[]` + the linked entity snapshots and ask the model whether the AC text matches the shape of those entities. Non-deterministic and expensive — call deliberately, not in a loop. Distinct from `check_consistency` (which is deterministic and structural). Output: { issues: [{ ac_slug, issue_type, details, affected_entity?, confidence, suggested_correction? }] }.',
    {
      acSlug: z.string().optional().describe('Limit analysis to a single AC by slug. Omit to analyse all active ACs.'),
    },
    async (args) => {
      try {
        const filterSlug = args.acSlug ? String(args.acSlug) : undefined;
        const allActive = deps.acService.list({ status: 'active' });
        const targets = filterSlug ? allActive.filter((a) => a.slug === filterSlug) : allActive;
        if (targets.length === 0) {
          return ok({ issues: [] });
        }

        const reader = new RawEntityReader(deps.db);
        const dossier = targets.map((ac) => {
          const linked = ac.verifies.map((v) => {
            if (!isRawEntityType(v.type)) {
              return { type: v.type, slug: v.slug, status: 'unknown-type' as const };
            }
            const entity = reader.getEntity(v.type as RawEntityType, v.slug);
            if (!entity) {
              return { type: v.type, slug: v.slug, status: 'missing' as const };
            }
            return {
              type: v.type,
              slug: v.slug,
              status: 'active' as const,
              data: entity.data,
            };
          });
          return { slug: ac.slug, text: ac.text, kind: ac.kind, linked };
        });

        const prompt = [
          'You are a specification consistency auditor.',
          '',
          'For each Acceptance Criterion (AC) below, decide whether its `text` is semantically consistent with the linked entities (their fields, params, shape).',
          '',
          'Return ONLY a JSON object on a single line, no prose, matching:',
          '{"issues":[{"ac_slug":string,"issue_type":string,"details":string,"affected_entity"?:{"type":string,"slug":string},"confidence":number,"suggested_correction"?:string}]}',
          '',
          'Rules:',
          '- If an AC has no issues, do not emit a row for it.',
          '- `confidence` is between 0 and 1.',
          '- `issue_type` is a short kebab-case label (e.g. "field-mismatch", "verb-mismatch", "missing-coverage", "stale-shape").',
          '- Skip ACs whose linked entities are missing or unknown-type (those are caught by check_consistency rule 9).',
          '',
          'Dossier:',
          JSON.stringify(dossier),
        ].join('\n');

        const adapter = createAdapter('claude-code');
        const stream = adapter.execute({
          prompt,
          systemPrompt: 'You output only a single JSON object on one line. No commentary, no code fences.',
          model: 'sonnet-4.6',
          cwd: deps.cwd,
          maxTurns: 1,
        });
        const text = await extractText(stream);

        const issues = parseIssuesJson(text);
        return ok({ issues });
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

interface AcAnalysisIssue {
  ac_slug: string;
  issue_type: string;
  details: string;
  affected_entity?: { type: string; slug: string };
  confidence: number;
  suggested_correction?: string;
}

function parseIssuesJson(text: string): AcAnalysisIssue[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  const slice = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const rawIssues = (parsed as Record<string, unknown>).issues;
  if (!Array.isArray(rawIssues)) return [];
  const out: AcAnalysisIssue[] = [];
  for (const raw of rawIssues) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.ac_slug !== 'string' || typeof r.issue_type !== 'string') continue;
    const details = typeof r.details === 'string' ? r.details : '';
    const confidence = typeof r.confidence === 'number' ? r.confidence : 0;
    const issue: AcAnalysisIssue = {
      ac_slug: r.ac_slug,
      issue_type: r.issue_type,
      details,
      confidence,
    };
    if (r.affected_entity && typeof r.affected_entity === 'object') {
      const ae = r.affected_entity as Record<string, unknown>;
      if (typeof ae.type === 'string' && typeof ae.slug === 'string') {
        issue.affected_entity = { type: ae.type, slug: ae.slug };
      }
    }
    if (typeof r.suggested_correction === 'string') {
      issue.suggested_correction = r.suggested_correction;
    }
    out.push(issue);
  }
  return out;
}
