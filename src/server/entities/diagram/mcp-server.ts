import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { DiagramService } from './services.js';
import { validateDiagramSource } from './validate.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
import type { DiagramCreateInput, DiagramFormat, DiagramUpdateInput } from '../../../shared/entities.js';

export interface DiagramToolsDeps {
  diagramService: DiagramService;
  referencesService: ReferencesService;
  ws: WsEmitter;
}

const formatSchema = z.enum(['mermaid', 'd2']);

export function createDiagramToolsServer(deps: DiagramToolsDeps): McpServerInstance {
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

  const createDiagram = mcpTool(
    'create_diagram',
    'Create a new diagram entity. The DSL `source` is the source of truth (rendered live on pages). ' +
      'A page references the diagram via a self-closing `<diagram slug="…" caption="…"/>` tag — `caption` is a ' +
      'per-reference attribute, NOT stored here. Slug: explicit `slug` | slugify(`caption`) | diagram-<nanoid>. ' +
      '`source` is validated with mermaid.parse() → warnings only, never blocks.',
    {
      source: z.string().optional().describe('DSL body (mermaid). May be empty (placeholder).'),
      format: formatSchema.optional().describe("Diagram language (default 'mermaid')."),
      caption: z
        .string()
        .optional()
        .describe('Transient — seeds the slug only (slugify(caption)); NOT persisted on the entity.'),
      slug: z.string().optional().describe('Explicit slug; collisions get a -2/-3 suffix.'),
      tags: z.array(z.string()).optional().describe('Tag slugs; non-existent tags are auto-created.'),
    },
    async (args) => {
      try {
        const input: DiagramCreateInput = {
          source: args.source as string | undefined,
          format: args.format as DiagramFormat | undefined,
          caption: args.caption as string | undefined,
          slug: args.slug as string | undefined,
          tags: args.tags as string[] | undefined,
        };
        const diagram = deps.diagramService.create(input, 'agent');
        const warnings = await validateDiagramSource(diagram.format, diagram.source);
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'diagram', slug: diagram.slug });
        return ok({
          id: diagram.slug,
          slug: diagram.slug,
          type: 'diagram',
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const getDiagram = mcpTool(
    'get_diagram',
    'Get a diagram by slug (format, source, tags).',
    { slug: z.string() },
    async (args) => {
      const diagram = deps.diagramService.getBySlug(String(args.slug));
      if (!diagram) return fail(new DomainError('NOT_FOUND', `diagram '${args.slug}' not found`));
      return ok(diagram);
    }
  );

  const updateDiagram = mcpTool(
    'update_diagram',
    'Update a diagram (partial). Slug is stable; rename only via newSlug (auto-propagates page references). ' +
      '`source` is validated with mermaid.parse() → warnings only, never blocks.',
    {
      slug: z.string(),
      data: z
        .object({
          source: z.string().optional(),
          format: formatSchema.optional(),
        })
        .describe('Partial fields to update.'),
      newSlug: z.string().optional().describe('Explicit slug rename.'),
    },
    async (args) => {
      try {
        const data = args.data as Record<string, unknown>;
        const input: DiagramUpdateInput = {
          source: data.source as string | undefined,
          format: data.format as DiagramFormat | undefined,
          newSlug: args.newSlug as string | undefined,
        };
        const { diagram, previousSlug } = deps.diagramService.update(String(args.slug), input, 'agent');
        if (diagram.slug !== previousSlug) {
          await deps.referencesService.propagateSlugChange('diagram', previousSlug, diagram.slug);
        }
        const warnings = await validateDiagramSource(diagram.format, diagram.source);
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'diagram', slug: diagram.slug });
        return ok({ slug: diagram.slug, updated: true, ...(warnings.length ? { warnings } : {}) });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const deleteDiagram = mcpTool(
    'delete_diagram',
    'Delete a diagram. Returns pages with now-broken `<diagram/>` references.',
    { slug: z.string() },
    async (args) => {
      try {
        const slug = String(args.slug);
        const refs = await deps.referencesService.findReferences('diagram', slug);
        deps.diagramService.remove(
          slug,
          'agent',
          refs.map((r) => ({
            pagePath: r.pagePath,
            tagType: r.tagType,
            line: r.line,
            slug,
            type: 'diagram' as const,
          }))
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'diagram', slug });
        return ok({
          deleted: true,
          brokenReferences: refs.map((r) => ({ pagePath: r.pagePath, count: 1 })),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const listDiagrams = mcpTool(
    'list_diagrams',
    'List diagrams with optional tag/search filtering. Returns slug, format, tags and a total.',
    {
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const query = {
          tags: args.tags as string[] | undefined,
          tagFilter: args.tagFilter as 'and' | 'or' | undefined,
          search: args.search as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        };
        const diagrams = deps.diagramService.list(query);
        const total = deps.diagramService.count(query);
        return ok({
          diagrams: diagrams.map((d) => ({ slug: d.slug, format: d.format, tags: d.tags })),
          total,
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  return createMcpServer({
    name: 'diagram-tools',
    tools: [createDiagram, getDiagram, updateDiagram, deleteDiagram, listDiagrams],
  });
}
