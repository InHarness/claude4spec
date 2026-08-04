import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { SerializationContribution } from '../../serialization/types.js';
import { uiViewSlug } from '../../services/slug.js';
import { uiViewSerializer } from './serializer.js';
import { uiViewSystemPrompt } from './system-prompt.js';
import { uiViewsRouter } from './routes.js';
import { UiViewService } from './service.js';
import { uiViewCreateSchema, uiViewUpdateSchema } from './crud-schemas.js';
import { uiViewData, uiViewSlugPattern } from '../../../shared/entities/ui-view/schema.js';

export const uiViewBackendModule: BackendModule = {
  type: 'ui-view',
  data: uiViewData,
  slugPattern: uiViewSlugPattern,
  payloadVersion: 1,
  label: 'UI View',
  labelPlural: 'UI Views',
  displayOrder: 40,
  pathPrefix: '/ui-views',
  /**
   * 0.2.2 — a ui-view's `designSystemSlug` points at a design-system, so that
   * type is indexed first. A dangling reference is only a warning (never an
   * error), but the order is DECLARED rather than left to chance so the warning
   * fires only when the design-system is genuinely absent.
   */
  dependsOn: ['design-system'],
  serializer: uiViewSerializer as SerializationContribution<unknown>,
  systemPrompt: uiViewSystemPrompt,
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router. No custom MCP server —
  // ui-view has no non-CRUD tools.
  backend: {
    // 2.0.0: the hand-written `onEntityRenamed` that repointed
    // `design_system_slug` is gone — `ref: 'design-system'` on the field says it.
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
