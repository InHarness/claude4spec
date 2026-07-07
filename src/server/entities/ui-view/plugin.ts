import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { uiViewSlug } from '../../services/slug.js';
import { uiViewSerializer } from './serializer.js';
import { uiViewSystemPrompt } from './system-prompt.js';
import { uiViewsRouter } from './routes.js';
import { UiViewService } from './service.js';
import { uiViewCreateSchema, uiViewUpdateSchema } from './crud-schemas.js';

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
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router. No custom MCP server —
  // ui-view has no non-CRUD tools.
  backend: {
    service: (ctx) => new UiViewService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: {
      createSchema: uiViewCreateSchema,
      updateSchema: uiViewUpdateSchema,
    },
    routes: {
      router: (service, ctx) => uiViewsRouter(service as UiViewService, ctx.referencesService, ctx.ws),
    },
  },
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(uiViewBackendModule);
}
