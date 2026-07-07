import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { endpointSlug } from '../../services/slug.js';
import { endpointSerializer } from './serializer.js';
import { endpointSystemPrompt } from './system-prompt.js';
import { endpointsRouter } from './routes.js';
import { EndpointService } from './service.js';
import { createEndpointToolsServer } from './mcp-server.js';
import { endpointCreateSchema, endpointUpdateSchema } from './crud-schemas.js';

export const endpointBackendModule: BackendModule = {
  type: 'endpoint',
  table: 'endpoint',
  label: 'Endpoint',
  labelPlural: 'Endpoints',
  displayOrder: 10,
  pathPrefix: '/endpoints',
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
    service: (ctx) => new EndpointService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: {
      createSchema: endpointCreateSchema,
      updateSchema: endpointUpdateSchema,
    },
    routes: {
      router: (service, ctx) => endpointsRouter(service as EndpointService, ctx.referencesService),
    },
    mcpServer: (service, ctx) => () =>
      createEndpointToolsServer({ endpointService: service as EndpointService, ws: ctx.ws }),
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(endpointBackendModule);
}
