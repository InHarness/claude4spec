import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import { acSlug } from '../../services/slug.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { acSerializer } from './serializer.js';
import { acSystemPrompt } from './system-prompt.js';
import { acsRouter } from './routes.js';
import { AcService } from './service.js';
import { createAcToolsServer } from './mcp-server.js';
import { acCreateSchema, acUpdateSchema } from './crud-schemas.js';

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
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router, mount the custom MCP
  // server for ac's semantic-audit tool.
  backend: {
    service: (ctx) => new AcService(ctx.db, ctx.tagsService, ctx.versionService, ctx.host, ctx.entityStore),
    crud: {
      createSchema: acCreateSchema,
      updateSchema: acUpdateSchema,
    },
    routes: {
      router: (service, ctx) => acsRouter(service as AcService, ctx.referencesService),
    },
    mcpServer: (service, ctx) =>
      createAcToolsServer({
        acService: service as AcService,
        db: ctx.db,
        cwd: ctx.cwd,
        host: ctx.host,
      }),
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(acBackendModule);
}
