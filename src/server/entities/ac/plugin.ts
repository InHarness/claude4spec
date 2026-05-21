import { pluginHost } from '../../core/plugin-host/host.js';
import type { BackendModule } from '../../core/plugin-host/types.js';
import { acSlug } from '../../services/slug.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { acSerializer } from './serializer.js';
import { acSystemPrompt } from './system-prompt.js';
import { acsRouter } from './routes.js';
import { AcService } from './services.js';
import { createAcToolsServer } from './mcp-server.js';

export const acBackendModule: BackendModule = {
  type: 'ac',
  table: 'ac',
  label: 'Acceptance Criterion',
  labelPlural: 'Acceptance Criteria',
  displayOrder: 50,
  pathPrefix: '/acs',
  slugFrom: (data) => acSlug((data as { text?: string }).text ?? ''),
  serializer: acSerializer as EntitySerializer<unknown>,
  systemPrompt: acSystemPrompt,
  backend: {
    mount(ctx) {
      const service = new AcService(ctx.db, ctx.tagsService, ctx.versionService, pluginHost);
      ctx.app.use(`/api${acBackendModule.pathPrefix}`, acsRouter(service, ctx.referencesService));
      ctx.registerMcpServer(
        `${acBackendModule.type}-tools`,
        () => createAcToolsServer({
          acService: service,
          referencesService: ctx.referencesService,
          ws: ctx.ws,
        }),
      );
      ctx.setIdResolver(acBackendModule.type, (slug) => service.getIdBySlug(slug));
      ctx.registerEntityService(acBackendModule.type, service);
    },
  },
};

pluginHost.registerBackendModule(acBackendModule);
