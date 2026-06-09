import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { EndpointService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsGateway } from '../../ws/gateway.js';
import { DomainError } from '../../services/tags.js';
import type { EndpointDtoRelation, HttpMethod } from '../../../shared/entities.js';

export interface EndpointToolsDeps {
  endpointService: EndpointService;
  referencesService: ReferencesService;
  ws: WsGateway;
}

export function createEndpointToolsServer(deps: EndpointToolsDeps): McpServerInstance {
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

  const createEndpoint = mcpTool(
    'create_endpoint',
    'Create a new HTTP endpoint entity. Generates slug from method+path. Use to define structured API endpoints in the specification.',
    {
      method: z.string().describe('HTTP method: GET, POST, PUT, PATCH, DELETE'),
      path: z.string().describe('URL path, e.g. /api/users/:id'),
      summary: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const ep = deps.endpointService.create(
          {
            method: String(args.method).toUpperCase() as HttpMethod,
            path: String(args.path),
            summary: args.summary as string | undefined,
            description: args.description as string | undefined,
            tags: args.tags as string[] | undefined,
          },
          'agent',
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'endpoint', slug: ep.slug });
        return ok({ id: ep.slug, slug: ep.slug, type: 'endpoint' });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const getEndpoint = mcpTool(
    'get_endpoint',
    'Get full details of an endpoint by slug. Returns all fields, tags, and related DTOs. Use to inspect endpoint details.',
    { slug: z.string() },
    async (args) => {
      const ep = deps.endpointService.getBySlug(String(args.slug));
      if (!ep) return fail(new DomainError('NOT_FOUND', `endpoint '${args.slug}' not found`));
      return ok(ep);
    },
  );

  const updateEndpoint = mcpTool(
    'update_endpoint',
    'Update endpoint fields (partial update). Only provided fields are changed. The slug is stable: changing method/path never moves it. Rename only via newSlug.',
    {
      slug: z.string(),
      data: z
        .object({
          method: z.string().optional(),
          path: z.string().optional(),
          summary: z.string().optional(),
          description: z.string().nullable().optional(),
        })
        .describe('Partial fields to update'),
      newSlug: z
        .string()
        .optional()
        .describe(
          'Explicit slug rename. The slug is not re-generated automatically when method/path changes.'
        ),
    },
    async (args) => {
      try {
        const data = args.data as Record<string, unknown>;
        const ep = deps.endpointService.update(
          String(args.slug),
          {
            method: data.method ? (String(data.method).toUpperCase() as HttpMethod) : undefined,
            path: data.path as string | undefined,
            summary: data.summary as string | undefined,
            description: data.description as string | null | undefined,
            newSlug: args.newSlug as string | undefined,
          },
          'agent',
        );
        const slugChanged = ep.slug !== args.slug;
        if (slugChanged) {
          await deps.referencesService.propagateSlugChange('endpoint', String(args.slug), ep.slug);
        }
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'endpoint', slug: ep.slug });
        return ok({ slug: ep.slug, updated: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const deleteEndpoint = mcpTool(
    'delete_endpoint',
    'Delete an endpoint. Returns list of pages with broken references. Use with caution.',
    { slug: z.string() },
    async (args) => {
      try {
        const slug = String(args.slug);
        const refs = await deps.referencesService.findReferences('endpoint', slug);
        const result = deps.endpointService.remove(slug, 'agent');
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'endpoint', slug });
        return ok({
          deleted: true,
          brokenReferences: refs.map((r) => ({ pagePath: r.pagePath, count: 1 })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const listEndpoints = mcpTool(
    'list_endpoints',
    'List endpoints with optional filtering by tags or search text. Use to find endpoints or get an overview.',
    {
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const list = deps.endpointService.list({
          tags: args.tags as string[] | undefined,
          tagFilter: args.tagFilter as 'and' | 'or' | undefined,
          search: args.search as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        return ok({
          endpoints: list.map((e) => ({
            slug: e.slug,
            method: e.method,
            path: e.path,
            summary: e.summary,
            tags: e.tags,
          })),
          total: list.length,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const linkDto = mcpTool(
    'link_dto',
    'Link a DTO to an endpoint as request body, response, or error response. Optional HTTP status code for response/error. Idempotent.',
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(['request', 'response', 'error']),
      statusCode: z.number().optional(),
    },
    async (args) => {
      try {
        deps.endpointService.linkDto(
          String(args.endpointSlug),
          String(args.dtoSlug),
          args.relation as EndpointDtoRelation,
          (args.statusCode as number | undefined) ?? null,
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'endpoint', slug: String(args.endpointSlug) });
        return ok({ linked: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const unlinkDto = mcpTool(
    'unlink_dto',
    'Remove a DTO link from an endpoint. Omit statusCode to remove all links (endpoint, dto, relation).',
    {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(['request', 'response', 'error']),
      statusCode: z.number().optional(),
    },
    async (args) => {
      try {
        deps.endpointService.unlinkDto(
          String(args.endpointSlug),
          String(args.dtoSlug),
          args.relation as EndpointDtoRelation,
          (args.statusCode as number | undefined) ?? null,
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'endpoint', slug: String(args.endpointSlug) });
        return ok({ unlinked: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'endpoint-tools',
    tools: [createEndpoint, getEndpoint, updateEndpoint, deleteEndpoint, listEndpoints, linkDto, unlinkDto],
  });
}
