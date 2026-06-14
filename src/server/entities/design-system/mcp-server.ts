import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { DesignSystemService } from './services.js';
import { resolve } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
import type {
  DesignMode,
  DesignSystemCreateInput,
  DesignSystemUpdateInput,
  TokenGroup,
} from '../../../shared/entities.js';

export interface DesignSystemToolsDeps {
  designSystemService: DesignSystemService;
  referencesService: ReferencesService;
  ws: WsEmitter;
}

const tokenValueSchema = z.union([z.string(), z.record(z.string(), z.string())]);

const tokenSchema = z.object({
  name: z.string().describe('Token name, unique within the design system'),
  type: z
    .string()
    .describe('TokenType (color|dimension|fontSize|...|typography|shadow). Best-effort, not hard-validated.'),
  value: tokenValueSchema.describe(
    'Literal ("#2563eb", "16px"), an alias "{token-name}", or a composite object (typography/shadow).'
  ),
  description: z.string().optional(),
});

const groupSchema = z.object({
  name: z.string(),
  tier: z.enum(['primitive', 'semantic']),
  tokens: z.array(tokenSchema),
});

const modeSchema = z.object({
  name: z.string(),
  overrides: z.array(z.object({ token: z.string(), value: tokenValueSchema })),
});

export function createDesignSystemToolsServer(deps: DesignSystemToolsDeps): McpServerInstance {
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

  const createDesignSystem = mcpTool(
    'create_design_system',
    'Create a new design system (named set of design tokens: primitive → semantic, with {token} aliases and optional theme modes). Generates slug from name.',
    {
      name: z.string().describe('Display name (e.g. "Brand 2026")'),
      description: z.string().optional(),
      groups: z.array(groupSchema).optional().describe('Token groups (default []).'),
      modes: z.array(modeSchema).optional().describe('Theme modes — token override sets (default []).'),
      slug: z.string().optional(),
      tags: z.array(z.string()).optional().describe('Tag slugs; non-existent tags are auto-created.'),
    },
    async (args) => {
      try {
        const input: DesignSystemCreateInput = {
          name: String(args.name),
          description: args.description as string | undefined,
          groups: (args.groups as TokenGroup[] | undefined) ?? [],
          modes: (args.modes as DesignMode[] | undefined) ?? [],
          slug: args.slug as string | undefined,
          tags: args.tags as string[] | undefined,
        };
        const { designSystem, warnings } = deps.designSystemService.create(input, 'agent');
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'design-system',
          slug: designSystem.slug,
        });
        return ok({
          id: designSystem.slug,
          slug: designSystem.slug,
          type: 'design-system',
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const getDesignSystem = mcpTool(
    'get_design_system',
    'Get full details of a design system by slug, including tags. With resolveMode, also returns `resolved` (tokenName → resolvedValue) for that mode (omit = Base).',
    {
      slug: z.string(),
      resolveMode: z
        .string()
        .optional()
        .describe('Theme mode name to resolve tokens for. Omit = Base (no overrides).'),
    },
    async (args) => {
      const ds = deps.designSystemService.getBySlug(String(args.slug));
      if (!ds) return fail(new DomainError('NOT_FOUND', `design system '${args.slug}' not found`));
      const resolveMode = args.resolveMode as string | undefined;
      const resolved = resolveMode !== undefined ? resolve(ds.groups, ds.modes, resolveMode) : undefined;
      return ok({ ...ds, ...(resolved ? { resolved } : {}) });
    }
  );

  const updateDesignSystem = mcpTool(
    'update_design_system',
    'Update a design system (partial). groups/modes are FULL REPLACE (not per-token patch). Slug is stable: changing name never moves it. Rename only via newSlug (auto-propagates references + ui-view designSystemSlug).',
    {
      slug: z.string(),
      data: z
        .object({
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          groups: z.array(groupSchema).optional(),
          modes: z.array(modeSchema).optional(),
        })
        .describe('Partial fields. groups/modes replace the whole array.'),
      newSlug: z.string().optional().describe('Explicit slug rename.'),
    },
    async (args) => {
      try {
        const data = args.data as Record<string, unknown>;
        const input: DesignSystemUpdateInput = {
          name: data.name as string | undefined,
          description: data.description as string | null | undefined,
          groups: data.groups as TokenGroup[] | undefined,
          modes: data.modes as DesignMode[] | undefined,
          newSlug: args.newSlug as string | undefined,
        };
        const { designSystem, previousSlug, warnings } = deps.designSystemService.update(
          String(args.slug),
          input,
          'agent'
        );
        if (designSystem.slug !== previousSlug) {
          await deps.referencesService.propagateSlugChange(
            'design-system',
            previousSlug,
            designSystem.slug
          );
        }
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'design-system',
          slug: designSystem.slug,
        });
        return ok({
          slug: designSystem.slug,
          updated: true,
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const deleteDesignSystem = mcpTool(
    'delete_design_system',
    'Delete a design system. Returns pages with broken references and ui-views whose designSystemSlug pointed at it (now dangling).',
    { slug: z.string() },
    async (args) => {
      try {
        const slug = String(args.slug);
        const refs = await deps.referencesService.findReferences('design-system', slug);
        const result = deps.designSystemService.remove(
          slug,
          'agent',
          refs.map((r) => ({
            pagePath: r.pagePath,
            tagType: r.tagType,
            line: r.line,
            slug,
            type: 'design-system' as const,
          }))
        );
        deps.ws.broadcast({ kind: 'entity:changed', entityType: 'design-system', slug });
        return ok({
          deleted: true,
          brokenReferences: refs.map((r) => ({ pagePath: r.pagePath, count: 1 })),
          danglingUiViews: result.danglingUiViews,
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const listDesignSystems = mcpTool(
    'list_design_systems',
    'List design systems with optional tag/search filtering. Returns trimmed rows with group/token/mode counts (no full token payload) and a total.',
    {
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const { items, total } = deps.designSystemService.listItems({
          tags: args.tags as string[] | undefined,
          tagFilter: args.tagFilter as 'and' | 'or' | undefined,
          search: args.search as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        return ok({
          designSystems: items.map((d) => ({
            slug: d.slug,
            name: d.name,
            description: d.description,
            groupCount: d.groupCount,
            tokenCount: d.tokenCount,
            modeCount: d.modeCount,
            tags: d.tags,
          })),
          total,
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  return createMcpServer({
    name: 'design-system-tools',
    tools: [
      createDesignSystem,
      getDesignSystem,
      updateDesignSystem,
      deleteDesignSystem,
      listDesignSystems,
    ],
  });
}
