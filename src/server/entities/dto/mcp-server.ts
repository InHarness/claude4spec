import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { DtoService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
import type { DtoExample, DtoField } from '../../../shared/entities.js';

export interface DtoToolsDeps {
  dtoService: DtoService;
  referencesService: ReferencesService;
  ws: WsEmitter;
}

export function createDtoToolsServer(deps: DtoToolsDeps): McpServerInstance {
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

  const fieldSchema = z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    description: z.string().optional(),
  });

  const exampleSchema = z.object({
    name: z.string().describe('Identifier unique within DTO (e.g. "minimal", "full", "edge-case")'),
    summary: z.string().optional(),
    value: z.unknown().describe('Payload as-is. Soft-validated against fields[] (warning only).'),
  });

  const createDto = mcpTool(
    'create_dto',
    'Create a new DTO (Data Transfer Object). Generates slug from name. Use to define structured data contracts.',
    {
      name: z.string().describe('DTO name (PascalCase, e.g. UserResponse)'),
      description: z.string().optional(),
      fields: z.array(fieldSchema).optional(),
      examples: z
        .array(exampleSchema)
        .optional()
        .describe('Named payload exemplars. Soft-validated. name unique within DTO.'),
      tags: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const dto = deps.dtoService.create(
          {
            name: String(args.name),
            description: args.description as string | undefined,
            fields: (args.fields as DtoField[] | undefined) ?? [],
            examples: (args.examples as DtoExample[] | undefined) ?? [],
            tags: args.tags as string[] | undefined,
          },
          'agent',
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'dto', slug: dto.slug });
        return ok({ id: dto.slug, slug: dto.slug, type: 'dto' });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const getDto = mcpTool(
    'get_dto',
    'Get full details of a DTO by slug. Returns all fields, examples, tags, and related endpoints.',
    { slug: z.string() },
    async (args) => {
      const dto = deps.dtoService.getBySlug(String(args.slug));
      if (!dto) return fail(new DomainError('NOT_FOUND', `dto '${args.slug}' not found`));
      return ok(dto);
    },
  );

  const updateDto = mcpTool(
    'update_dto',
    'Update DTO fields (partial update). Only provided fields are changed. The slug is stable: changing name never moves it. Rename only via newSlug.',
    {
      slug: z.string(),
      data: z
        .object({
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          fields: z.array(fieldSchema).optional(),
          examples: z
            .array(exampleSchema)
            .optional()
            .describe('Full replace of examples array (not diff). Omit to leave unchanged.'),
        })
        .describe('Partial fields to update'),
      newSlug: z
        .string()
        .optional()
        .describe(
          'Explicit slug rename. The slug is not re-generated automatically when name changes.'
        ),
    },
    async (args) => {
      try {
        const data = args.data as Record<string, unknown>;
        const { dto, previousSlug } = deps.dtoService.update(
          String(args.slug),
          {
            name: data.name as string | undefined,
            description: data.description as string | null | undefined,
            fields: data.fields as DtoField[] | undefined,
            examples: data.examples as DtoExample[] | undefined,
            newSlug: args.newSlug as string | undefined,
          },
          'agent',
        );
        if (dto.slug !== previousSlug) {
          await deps.referencesService.propagateSlugChange('dto', previousSlug, dto.slug);
        }
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'dto', slug: dto.slug });
        return ok({ slug: dto.slug, updated: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const deleteDto = mcpTool(
    'delete_dto',
    'Delete a DTO. Returns list of pages with broken references. Use with caution.',
    { slug: z.string() },
    async (args) => {
      try {
        const slug = String(args.slug);
        const refs = await deps.referencesService.findReferences('dto', slug);
        deps.dtoService.remove(slug, 'agent');
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'dto', slug });
        return ok({
          deleted: true,
          brokenReferences: refs.map((r) => ({ pagePath: r.pagePath, count: 1 })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  const listDtos = mcpTool(
    'list_dtos',
    'List DTOs with optional filtering by tags or search text.',
    {
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const list = deps.dtoService.list({
          tags: args.tags as string[] | undefined,
          tagFilter: args.tagFilter as 'and' | 'or' | undefined,
          search: args.search as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        return ok({
          dtos: list.map((d) => ({
            slug: d.slug,
            name: d.name,
            description: d.description,
            tags: d.tags,
          })),
          total: list.length,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return createMcpServer({
    name: 'dto-tools',
    tools: [createDto, getDto, updateDto, deleteDto, listDtos],
  });
}
