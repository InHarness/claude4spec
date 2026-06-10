import { createMcpServer, mcpTool, type McpServerInstance } from '@inharness-ai/agent-adapters';
import { z } from 'zod';
import type { DatabaseTableService } from './services.js';
import type { ReferencesService } from '../../services/references.js';
import type { WsEmitter } from '../../ws/project-emitter.js';
import { DomainError } from '../../services/tags.js';
import type {
  DatabaseTableColumn,
  DatabaseTableIndex,
} from '../../../shared/entities.js';

export interface DatabaseToolsDeps {
  databaseTableService: DatabaseTableService;
  referencesService: ReferencesService;
  ws: WsEmitter;
}

export function createDatabaseToolsServer(deps: DatabaseToolsDeps): McpServerInstance {
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

  const columnSchema = z.object({
    name: z.string(),
    type: z.string(),
    nullable: z.boolean().optional(),
    unique: z.boolean().optional(),
    pk: z.boolean().optional(),
    fk: z
      .object({
        table: z.string(),
        column: z.string(),
      })
      .optional(),
    default: z.string().optional(),
    enumValues: z.array(z.string()).optional(),
    description: z.string().optional(),
  });

  const indexSchema = z.object({
    columns: z.array(z.string()),
    unique: z.boolean().optional(),
    name: z.string().optional(),
  });

  const createDatabaseTable = mcpTool(
    'create_database_table',
    'Create a new database table (relational model, dialect-agnostic). Generates slug from name. Use to define table structure with columns and indexes.',
    {
      name: z.string().describe('Table name (snake_case, e.g. users, order_items)'),
      description: z.string().optional(),
      columns: z.array(columnSchema).optional(),
      indexes: z.array(indexSchema).optional(),
      slug: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const { dbTable, warnings } = deps.databaseTableService.create(
          {
            name: String(args.name),
            description: args.description as string | undefined,
            columns: (args.columns as DatabaseTableColumn[] | undefined) ?? [],
            indexes: (args.indexes as DatabaseTableIndex[] | undefined) ?? [],
            slug: args.slug as string | undefined,
            tags: args.tags as string[] | undefined,
          },
          'agent'
        );
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'database-table',
          slug: dbTable.slug,
        });
        return ok({
          id: dbTable.slug,
          slug: dbTable.slug,
          type: 'database-table',
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const getDatabaseTable = mcpTool(
    'get_database_table',
    'Get full details of a database table by slug. Returns columns, indexes, and tags. Use to inspect table structure.',
    { slug: z.string() },
    async (args) => {
      const dbTable = deps.databaseTableService.getBySlug(String(args.slug));
      if (!dbTable)
        return fail(new DomainError('NOT_FOUND', `database table '${args.slug}' not found`));
      return ok(dbTable);
    }
  );

  const updateDatabaseTable = mcpTool(
    'update_database_table',
    'Update database table fields (partial update). Only provided fields are changed. The slug is stable: changing name never moves it. Rename only via newSlug, which auto-propagates XML references in markdown and fk.table values in other tables.',
    {
      slug: z.string(),
      data: z
        .object({
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          columns: z.array(columnSchema).optional(),
          indexes: z.array(indexSchema).optional(),
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
        const { dbTable, previousSlug, warnings } = deps.databaseTableService.update(
          String(args.slug),
          {
            name: data.name as string | undefined,
            description: data.description as string | null | undefined,
            columns: data.columns as DatabaseTableColumn[] | undefined,
            indexes: data.indexes as DatabaseTableIndex[] | undefined,
            newSlug: args.newSlug as string | undefined,
          },
          'agent'
        );
        if (dbTable.slug !== previousSlug) {
          await deps.referencesService.propagateSlugChange(
            'database-table',
            previousSlug,
            dbTable.slug
          );
          const { changedTables } = deps.databaseTableService.propagateFkSlugChange(
            previousSlug,
            dbTable.slug,
            'agent'
          );
          for (const s of changedTables) {
            deps.ws.broadcast({
              kind: 'entity:changed',
              entityType: 'database-table',
              slug: s,
            });
          }
        }
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'database-table',
          slug: dbTable.slug,
        });
        return ok({
          slug: dbTable.slug,
          updated: true,
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const deleteDatabaseTable = mcpTool(
    'delete_database_table',
    'Delete a database table. Returns list of pages with broken references and tables with dangling FKs (user/agent decides follow-up). Use with caution.',
    { slug: z.string() },
    async (args) => {
      try {
        const slug = String(args.slug);
        const refs = await deps.referencesService.findReferences('database-table', slug);
        const result = deps.databaseTableService.remove(slug, 'agent');
        deps.ws.broadcast({
          kind: 'entity:changed',
          entityType: 'database-table',
          slug,
        });
        return ok({
          deleted: true,
          brokenReferences: refs.map((r) => ({ pagePath: r.pagePath, count: 1 })),
          danglingFks: result.danglingFks,
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  const listDatabaseTables = mcpTool(
    'list_database_tables',
    'List database tables with optional filtering by tags or search text. Use to find tables or get an overview.',
    {
      tags: z.array(z.string()).optional(),
      tagFilter: z.enum(['and', 'or']).optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async (args) => {
      try {
        const list = deps.databaseTableService.list({
          tags: args.tags as string[] | undefined,
          tagFilter: args.tagFilter as 'and' | 'or' | undefined,
          search: args.search as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        return ok({
          tables: list.map((t) => ({
            slug: t.slug,
            name: t.name,
            description: t.description,
            columnCount: t.columns.length,
            tags: t.tags,
          })),
          total: list.length,
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  return createMcpServer({
    name: 'database-tools',
    tools: [
      createDatabaseTable,
      getDatabaseTable,
      updateDatabaseTable,
      deleteDatabaseTable,
      listDatabaseTables,
    ],
  });
}
