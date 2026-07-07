import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { designSystemSlug } from '../../services/slug.js';
import { designSystemSerializer } from './serializer.js';
import { designSystemSystemPrompt } from './system-prompt.js';
import { designSystemsRouter } from './routes.js';
import { DesignSystemService } from './service.js';
import { designSystemCreateSchema, designSystemUpdateSchema } from './crud-schemas.js';

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
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router. design-system has no
  // non-CRUD tools, so there is no `mcpServer` key at all.
  backend: {
    service: (ctx) => new DesignSystemService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: {
      createSchema: designSystemCreateSchema,
      updateSchema: designSystemUpdateSchema,
    },
    routes: {
      router: (service, ctx) =>
        designSystemsRouter(service as DesignSystemService, ctx.referencesService, ctx.ws),
    },
  },
};

export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(designSystemBackendModule);
}
