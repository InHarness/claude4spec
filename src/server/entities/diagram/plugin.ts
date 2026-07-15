import { nanoid } from 'nanoid';
import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { EntitySerializer } from '../../serialization/types.js';
import { slugify } from '../../services/slug.js';
import { diagramSerializer } from './serializer.js';
import { diagramSystemPrompt } from './system-prompt.js';
import { diagramsRouter } from './routes.js';
import { DiagramService } from './service.js';
import { createDiagramToolsServer } from './mcp-server.js';
import { diagramCreateSchema, diagramUpdateSchema } from './crud-schemas.js';

export const diagramBackendModule: BackendModule = {
  type: 'diagram',
  table: 'diagram',
  label: 'Diagram',
  labelPlural: 'Diagrams',
  // After design-system (60) — diagrams sit at the end of ELEMENTS.
  displayOrder: 70,
  pathPrefix: '/diagrams',
  // Decyzja #1: explicit slug | slugify(caption) | diagram-<nanoid(8)>.
  // The service does the authoritative generation (with collision suffixing);
  // this manifest helper mirrors the fallback for generic callers.
  slugFrom: (data) => {
    const d = (data ?? {}) as { slug?: string; caption?: string };
    return d.slug?.trim() || (d.caption ? slugify(d.caption) : `diagram-${nanoid(8)}`);
  },
  serializer: diagramSerializer as EntitySerializer<unknown>,
  systemPrompt: diagramSystemPrompt,
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router, mount the custom MCP
  // server for diagram's pre-flight validation tool.
  backend: {
    service: (ctx) => new DiagramService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    crud: {
      createSchema: diagramCreateSchema,
      updateSchema: diagramUpdateSchema,
    },
    routes: {
      router: (service, ctx) => diagramsRouter(service as DiagramService, ctx.referencesService, ctx.ws),
    },
    mcpServer: () => () => createDiagramToolsServer(),
  },
  // v0.1.129 (M19 Slot B) — <diagram/> as the 7th XML reference type, via the
  // entity's own module instead of a standalone bootstrap side-effect call
  // (see project-context.ts). `caption` is a per-reference attribute (not
  // stored on the entity); `slug` identifies the diagram entity. `entityType`
  // is auto-injected by `registerEntityModule` as `module.type` ('diagram').
  frontend: {
    referenceType: { tag: 'diagram', attrOrder: ['slug', 'caption'] },
  },
};

export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(diagramBackendModule);
}
