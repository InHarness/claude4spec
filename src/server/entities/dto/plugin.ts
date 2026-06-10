import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import { dtoSlug } from '../../services/slug.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { dtoSerializer } from './serializer.js';
import { dtoSystemPrompt } from './system-prompt.js';
import { dtosRouter } from './routes.js';
import { DtoService } from './services.js';
import { createDtoToolsServer } from './mcp-server.js';

export const dtoBackendModule: BackendModule = {
  type: 'dto',
  table: 'dto',
  label: 'DTO',
  labelPlural: 'DTOs',
  displayOrder: 20,
  pathPrefix: '/dtos',
  slugFrom: (data) => dtoSlug((data as { name: string }).name),
  serializer: dtoSerializer as EntitySerializer<unknown>,
  systemPrompt: dtoSystemPrompt,
  backend: {
    mount(ctx) {
      const service = new DtoService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore);
      ctx.app.use(`${dtoBackendModule.pathPrefix}`, dtosRouter(service, ctx.referencesService));
      ctx.registerMcpServer(
        `${dtoBackendModule.type}-tools`,
        () => createDtoToolsServer({
          dtoService: service,
          referencesService: ctx.referencesService,
          ws: ctx.ws,
        }),
      );
      ctx.registerEntityService(dtoBackendModule.type, service);
    },
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(dtoBackendModule);
}
