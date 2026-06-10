import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { uiViewSlug } from '../../services/slug.js';
import { uiViewSerializer } from './serializer.js';
import { uiViewSystemPrompt } from './system-prompt.js';
import { uiViewsRouter } from './routes.js';
import { UiViewService } from './services.js';
import { createUiViewToolsServer } from './mcp-server.js';

export const uiViewBackendModule: BackendModule = {
  type: 'ui-view',
  table: 'ui_view',
  label: 'UI View',
  labelPlural: 'UI Views',
  displayOrder: 40,
  pathPrefix: '/ui-views',
  slugFrom: (data) => uiViewSlug((data as { name: string }).name),
  serializer: uiViewSerializer as EntitySerializer<unknown>,
  systemPrompt: uiViewSystemPrompt,
  backend: {
    mount(ctx) {
      const service = new UiViewService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore);
      ctx.app.use(
        `${uiViewBackendModule.pathPrefix}`,
        uiViewsRouter(service, ctx.referencesService, ctx.ws),
      );
      ctx.registerMcpServer(
        `${uiViewBackendModule.type}-tools`,
        () => createUiViewToolsServer({
          uiViewService: service,
          referencesService: ctx.referencesService,
          ws: ctx.ws,
        }),
      );
      ctx.registerEntityService(uiViewBackendModule.type, service);
    },
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(uiViewBackendModule);
}
