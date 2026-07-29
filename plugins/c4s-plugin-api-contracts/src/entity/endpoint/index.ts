import type { EntityContribution, EntityRenamedEvent, MountContext } from '@c4s/plugin-runtime';
import {
  ENDPOINT_DISPLAY_ORDER,
  ENDPOINT_DTO_TABLE,
  ENDPOINT_PATH_PREFIX,
  ENDPOINT_TABLE,
  ENDPOINT_TYPE,
  endpointSlug,
} from '../../identity.js';
import { endpointSerializer } from './serializer.js';
import { endpointSystemPrompt } from './system-prompt.js';
import { endpointsRouter } from './backend/routes.js';
import { EndpointService } from './backend/services.js';
import { createEndpointToolsServer } from './backend/mcp.js';
import { endpointCreateSchema, endpointUpdateSchema } from './backend/crud-schemas.js';
import { endpointMigrations } from './backend/migrations.js';

/**
 * The `endpoint` contribution — the side of the pair that owns the junction.
 */
export const endpointEntity: EntityContribution = {
  type: ENDPOINT_TYPE,
  table: ENDPOINT_TABLE,
  label: 'Endpoint',
  labelPlural: 'Endpoints',
  displayOrder: ENDPOINT_DISPLAY_ORDER,
  pathPrefix: ENDPOINT_PATH_PREFIX,
  /**
   * Restore and index order is declared here, by the module that knows the
   * constraint. An endpoint links DTOs through the junction, so DTO rows must
   * exist first or the FK rejects the link. "DTO before Endpoint" is the RESULT
   * of this line; the host's topological sort only consumes it.
   */
  dependsOn: ['dto'],
  slugFrom: (data: unknown) => {
    const d = data as { method?: string; path?: string };
    return endpointSlug(d.method ?? 'GET', d.path ?? '');
  },
  serializer: endpointSerializer,
  systemPrompt: endpointSystemPrompt,
  backend: {
    migrations: endpointMigrations,
    /**
     * The junction's rows are derived from the endpoint files' `linked_dtos[]`,
     * so a full index rebuild must clear it before repopulating. Declared rather
     * than hardcoded in the host indexer, which has no idea this table exists.
     */
    auxTables: [ENDPOINT_DTO_TABLE],
    /**
     * A DTO rename cascades through the junction's ON UPDATE CASCADE, but the
     * endpoint FILES still embed the old slug in `linked_dtos[]`. Re-persist the
     * affected ones. This was a `type === 'dto'` branch in the host's
     * ReferencesService — knowledge belonging to whoever owns the link.
     */
    onEntityRenamed: ({ type, newSlug }: EntityRenamedEvent, ctx: MountContext) => {
      if (type !== 'dto') return;
      const affected = ctx.db
        .prepare(`SELECT DISTINCT endpoint_slug AS slug FROM ${ENDPOINT_DTO_TABLE} WHERE dto_slug = ?`)
        .all(newSlug) as Array<{ slug: string }>;
      for (const e of affected) {
        try {
          ctx.entityStore.persist(ENDPOINT_TYPE, e.slug);
        } catch {
          /* a file that cannot be re-persisted is skipped, as before */
        }
      }
    },
    service: (ctx: MountContext) => new EndpointService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: { createSchema: endpointCreateSchema, updateSchema: endpointUpdateSchema },
    routes: {
      router: (service: unknown, ctx: MountContext) => endpointsRouter(service as EndpointService, ctx.referencesService),
    },
    mcpServer: (service: unknown, ctx: MountContext) =>
      createEndpointToolsServer({ endpointService: service as EndpointService, ws: ctx.ws }),
  },
} as EntityContribution;
