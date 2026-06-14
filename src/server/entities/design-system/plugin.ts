import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { designSystemSlug } from '../../services/slug.js';
import { designSystemSerializer } from './serializer.js';
import { designSystemSystemPrompt } from './system-prompt.js';
import { designSystemsRouter } from './routes.js';
import { DesignSystemService } from './services.js';
import { createDesignSystemToolsServer } from './mcp-server.js';

export const designSystemBackendModule: BackendModule = {
  type: 'design-system',
  table: 'design_system',
  label: 'Design System',
  labelPlural: 'Design Systems',
  // After ui-view (40) and ac (50) — design systems sit at the end of ELEMENTS.
  displayOrder: 60,
  pathPrefix: '/design-systems',
  slugFrom: (data) => designSystemSlug((data as { name: string }).name),
  serializer: designSystemSerializer as EntitySerializer<unknown>,
  systemPrompt: designSystemSystemPrompt,
  backend: {
    mount(ctx) {
      const service = new DesignSystemService(
        ctx.db,
        ctx.tagsService,
        ctx.versionService,
        ctx.entityStore
      );
      ctx.app.use(
        `${designSystemBackendModule.pathPrefix}`,
        designSystemsRouter(service, ctx.referencesService, ctx.ws)
      );
      ctx.registerMcpServer(
        `${designSystemBackendModule.type}-tools`,
        () =>
          createDesignSystemToolsServer({
            designSystemService: service,
            referencesService: ctx.referencesService,
            ws: ctx.ws,
          })
      );
      ctx.registerEntityService(designSystemBackendModule.type, service);
    },
  },
};

export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(designSystemBackendModule);
}
