import { pluginHost } from '../../core/plugin-host/host.js';
import type { BackendModule } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { endpointSlug } from '../../services/slug.js';
import { endpointSerializer } from './serializer.js';
import { endpointSystemPrompt } from './system-prompt.js';
import { endpointsRouter } from './routes.js';
import { EndpointService } from './services.js';
import { createEndpointToolsServer } from './mcp-server.js';

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
  backend: {
    mount(ctx) {
      const service = new EndpointService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore);
      ctx.app.use(`/api${endpointBackendModule.pathPrefix}`, endpointsRouter(service, ctx.referencesService));
      ctx.registerMcpServer(
        `${endpointBackendModule.type}-tools`,
        () => createEndpointToolsServer({
          endpointService: service,
          referencesService: ctx.referencesService,
          ws: ctx.ws,
        }),
      );
      ctx.registerEntityService(endpointBackendModule.type, service);
    },
  },
};

pluginHost.registerBackendModule(endpointBackendModule);
