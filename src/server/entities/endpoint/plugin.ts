import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { endpointSlug } from '../../services/slug.js';
import { endpointSerializer } from './serializer.js';
import { endpointSystemPrompt } from './system-prompt.js';
import { endpointsRouter } from './routes.js';
import { EndpointService } from './service.js';
import { createEndpointToolsServer } from './mcp-server.js';
import { endpointCreateSchema, endpointUpdateSchema } from './crud-schemas.js';
import { endpointMigrations } from './migrations.js';

export const endpointBackendModule: BackendModule = {
  type: 'endpoint',
  table: 'endpoint',
  label: 'Endpoint',
  labelPlural: 'Endpoints',
  displayOrder: 10,
  pathPrefix: '/endpoints',
  /**
   * 0.2.2 — restore/index order is declared here, by the module that knows the
   * constraint, instead of being hardcoded in the host. An endpoint links DTOs
   * through the `endpoint_dto` junction, so DTO rows must exist first (the FK
   * would otherwise reject the link). "DTO before Endpoint" is the RESULT of
   * this line; the host's topological sort only consumes it.
   */
  dependsOn: ['dto'],
  slugFrom: (data) => {
    const d = data as { method?: string; path?: string };
    return endpointSlug(d.method ?? 'GET', d.path ?? '');
  },
  serializer: endpointSerializer as EntitySerializer<unknown>,
  systemPrompt: endpointSystemPrompt,
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router, mount the custom MCP
  // server for endpoint's relation tools.
  backend: {
    migrations: endpointMigrations,
    /**
     * The junction is derived from the endpoint files' `linked_dtos[]`, so a
     * full index rebuild must clear it before repopulating. Declared here rather
     * than hardcoded in the indexer: the host has no idea this table exists.
     */
    auxTables: ['endpoint_dto'],
    /**
     * A DTO rename cascades through the junction's ON UPDATE CASCADE, but the
     * endpoint FILES still embed the old slug in `linked_dtos[]`. Re-persist the
     * affected ones. This used to be a `type === 'dto'` branch inside the host's
     * ReferencesService — knowledge that belongs to the module owning the link.
     */
    onEntityRenamed: ({ type, newSlug }, ctx) => {
      if (type !== 'dto') return;
      const affected = ctx.db
        .prepare('SELECT DISTINCT endpoint_slug AS slug FROM endpoint_dto WHERE dto_slug = ?')
        .all(newSlug) as Array<{ slug: string }>;
      for (const e of affected) {
        try {
          ctx.entityStore.persist('endpoint', e.slug);
        } catch {
          /* a file that cannot be re-persisted is skipped, as before */
        }
      }
    },
    service: (ctx) => new EndpointService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: {
      createSchema: endpointCreateSchema,
      updateSchema: endpointUpdateSchema,
    },
    routes: {
      router: (service, ctx) => endpointsRouter(service as EndpointService, ctx.referencesService),
    },
    mcpServer: (service, ctx) =>
      createEndpointToolsServer({ endpointService: service as EndpointService, ws: ctx.ws }),
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(endpointBackendModule);
}
