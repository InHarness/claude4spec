import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import { dtoSlug } from '../../services/slug.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { dtoSerializer } from './serializer.js';
import { dtoSystemPrompt } from './system-prompt.js';
import { dtosRouter } from './routes.js';
import { DtoService } from './service.js';
import { dtoCreateSchema, dtoUpdateSchema } from './crud-schemas.js';

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
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router. No custom MCP server — dto
  // has no non-CRUD tools left.
  backend: {
    service: (ctx) => new DtoService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: {
      createSchema: dtoCreateSchema,
      updateSchema: dtoUpdateSchema,
    },
    routes: {
      router: (service, ctx) => dtosRouter(service as DtoService, ctx.referencesService),
    },
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(dtoBackendModule);
}
