import { pluginHost } from '../../core/plugin-host/host.js';
import type { BackendModule } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { databaseTableSlug } from '../../services/slug.js';
import { databaseTableSerializer } from './serializer.js';
import { databaseTableSystemPrompt } from './system-prompt.js';
import { databaseTablesRouter } from './routes.js';
import { DatabaseTableService } from './services.js';
import { createDatabaseToolsServer } from './mcp-server.js';

export const databaseTableBackendModule: BackendModule = {
  type: 'database-table',
  table: 'database_table',
  label: 'Database Table',
  labelPlural: 'Database Tables',
  displayOrder: 30,
  pathPrefix: '/database-tables',
  slugFrom: (data) => databaseTableSlug((data as { name: string }).name),
  serializer: databaseTableSerializer as EntitySerializer<unknown>,
  systemPrompt: databaseTableSystemPrompt,
  backend: {
    mount(ctx) {
      const service = new DatabaseTableService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore);
      ctx.app.use(
        `/api${databaseTableBackendModule.pathPrefix}`,
        databaseTablesRouter(service, ctx.referencesService, ctx.ws),
      );
      ctx.registerMcpServer(
        `${databaseTableBackendModule.type}-tools`,
        () => createDatabaseToolsServer({
          databaseTableService: service,
          referencesService: ctx.referencesService,
          ws: ctx.ws,
        }),
      );
      ctx.registerEntityService(databaseTableBackendModule.type, service);
    },
  },
};

pluginHost.registerBackendModule(databaseTableBackendModule);
