import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { UiViewService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsGateway } from '../../ws/gateway.js';
import { DomainError } from '../../services/tags.js';
import type { UiViewParam } from '../../../shared/entities.js';

export interface UiViewToolsDeps {
  uiViewService: UiViewService;
  referencesService: ReferencesService;
  ws: WsGateway;
}

export function createUiViewToolsServer(deps: UiViewToolsDeps): McpServerInstance {
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

  const paramSchema = z.object({
    name: z.string().describe('Parameter name (no `:` prefix)'),
    in: z.enum(['path', 'query', 'hash']).describe('Where the param lives'),
    type: z.string().optional().describe('Suggested value type (string|int|uuid|enum|...)'),
    required: z.boolean().optional(),
    default: z.string().optional(),
    description: z.string().optional(),
  });

  const createUiView = mcpTool(
    'create_ui_view',
    'Create a new UI view (screen-level documentation). Generates slug from name. Use to document a screen, modal, or drawer with its routing contract (URL + params).',
    {
      name: z.string().describe('Display name (e.g. "User Profile Screen")'),
      url: z
        .string()
        .nullable()
        .optional()
        .describe('Route pattern (e.g. "/users/:id"). Null/omitted = modal/drawer without routing.'),
      description: z.string().optional(),
      params: z.array(paramSchema).optional(),
      slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const { uiView, warnings } = deps.uiViewService.create(
          {
            name: String(args.name),
            url: args.url as string | null | undefined,
            description: args.description as string | undefined,
            params: (args.params as UiViewParam[] | undefined) ?? [],
            slug: args.slug as string | undefined,
            tags: args.tags as string[] | undefined,
          },
          'agent'
        );
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'ui-view',
          slug: uiView.slug,
        });
        return ok({
          id: uiView.slug,
          slug: uiView.slug,
          type: 'ui-view',
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const getUiView = mcpTool(
    'get_ui_view',
    'Get full details of a UI view by slug. Returns name, url, description, params, and tags. Use to inspect view structure.',
    { slug: z.string() },
    async (args) => {
      const uiView = deps.uiViewService.getBySlug(String(args.slug));
      if (!uiView)
        return fail(new DomainError('NOT_FOUND', `ui view '${args.slug}' not found`));
      return ok(uiView);
    }
  );

  const updateUiView = mcpTool(
    'update_ui_view',
    'Update UI view fields (partial update). Only provided fields are changed. Renaming slug auto-propagates XML references in markdown.',
    {
      slug: z.string(),
      data: z
        .object({
          name: z.string().optional(),
          url: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          params: z.array(paramSchema).optional(),
        })
        .describe('Partial fields to update'),
      newSlug: z.string().optional(),
    },
    async (args) => {
      try {
        const data = args.data as Record<string, unknown>;
        const { uiView, previousSlug, warnings } = deps.uiViewService.update(
          String(args.slug),
          {
            name: data.name as string | undefined,
            url: data.url as string | null | undefined,
            description: data.description as string | null | undefined,
            params: data.params as UiViewParam[] | undefined,
            newSlug: args.newSlug as string | undefined,
          },
          'agent'
        );
        if (uiView.slug !== previousSlug) {
          await deps.referencesService.propagateSlugChange(
            'ui-view',
            previousSlug,
            uiView.slug
          );
        }
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'ui-view',
          slug: uiView.slug,
        });
        return ok({
          slug: uiView.slug,
          updated: true,
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const deleteUiView = mcpTool(
    'delete_ui_view',
    'Delete a UI view. Returns list of pages with broken references. Use with caution.',
    { slug: z.string() },
    async (args) => {
      try {
        const slug = String(args.slug);
        const refs = await deps.referencesService.findReferences('ui-view', slug);
        deps.uiViewService.remove(slug, 'agent');
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'ui-view',
          slug,
        });
        return ok({
          deleted: true,
          brokenReferences: refs.map((r) => ({ pagePath: r.pagePath, count: 1 })),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const listUiViews = mcpTool(
    'list_ui_views',
    'List UI views with optional filtering by tags or search text. Use to find views or get an overview.',
    {
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const list = deps.uiViewService.list({
          tags: args.tags as string[] | undefined,
          tagFilter: args.tagFilter as 'and' | 'or' | undefined,
          search: args.search as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        return ok({
          views: list.map((v) => ({
            slug: v.slug,
            name: v.name,
            url: v.url,
            description: v.description,
            paramCount: v.params.length,
            tags: v.tags,
          })),
          total: list.length,
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  return createMcpServer({
    name: 'ui-view-tools',
    tools: [createUiView, getUiView, updateUiView, deleteUiView, listUiViews],
  });
}
