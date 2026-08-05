import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { SerializationContribution } from '../../serialization/types.js';
import { diagramSerializer } from './serializer.js';
import { diagramSystemPrompt } from './system-prompt.js';
import { diagramsRouter } from './routes.js';
import { DiagramService } from './service.js';
import { createDiagramToolsServer } from './mcp-server.js';
import { diagramData, diagramSlugPattern } from '../../../shared/entities/diagram/schema.js';

export const diagramBackendModule: BackendModule = {
  type: 'diagram',
  data: diagramData,
  slugPattern: diagramSlugPattern,
  payloadVersion: 1,
  label: 'Diagram',
  labelPlural: 'Diagrams',
  // After design-system (60) — diagrams sit at the end of ELEMENTS.
  displayOrder: 70,
  pathPrefix: '/diagrams',
  serializer: diagramSerializer as SerializationContribution<unknown>,
  systemPrompt: diagramSystemPrompt,
  // M13: declarative backend — the host synthesizes an equivalent `mount` (see
  // manifest-adapter.ts#synthesizeMount): construct the service once, register
  // it for DI + entity-tools, mount the REST router, mount the custom MCP
  // server for diagram's pre-flight validation tool.
  backend: {
    service: (ctx) => new DiagramService(ctx.db, ctx.tagsService, ctx.versionService, ctx.entityStore),
    routes: {
      router: (service, ctx) => diagramsRouter(service as DiagramService, ctx.referencesService, ctx.ws),
    },
    mcpServer: () => createDiagramToolsServer(),
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
