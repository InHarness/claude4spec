import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { SerializationContribution } from '../../serialization/types.js';
import { diagramSerializer } from './serializer.js';
import { diagramSystemPrompt } from './system-prompt.js';
import { createDiagramToolsServer } from './mcp-server.js';
import { diagramData, diagramSlugPattern } from '../../../shared/entities/diagram/schema.js';

export const diagramBackendModule: BackendModule = {
  type: 'diagram',
  data: diagramData,
  slugPattern: diagramSlugPattern,
  payloadVersion: 1,
  // Slug is slugified prose (ac: `text`, diagram: `caption`), so two entities
  // that start alike are two entities — suffix rather than refuse. See
  // `slugConflict` on the manifest; every identity-derived type takes the default.
  slugConflict: 'suffix',

  label: 'Diagram',
  labelPlural: 'Diagrams',
  // After design-system (60) — diagrams sit at the end of ELEMENTS.
  displayOrder: 70,
  pathPrefix: '/diagrams',
  serializer: diagramSerializer as SerializationContribution<unknown>,
  systemPrompt: diagramSystemPrompt,
  /**
   * 2.0.0 tier K (item 56) — `mcpServer` and NOTHING else. `validate_diagram`
   * checks a raw DSL string with no database lookup (the entity need not exist
   * yet), so it never needed the service the old `mcpServer requires service`
   * rule forced this type to declare.
   *
   * The service also carried `readFormat`, which COERCED an unknown `format` to
   * `'mermaid'` on write. That is gone with it: `format` is declared
   * `enum ['mermaid','d2']`, so `POST /api/diagrams` with `format: 'graphviz'`
   * now answers 400 instead of quietly storing a mermaid diagram. Decoding a
   * stored row still tolerates a bad value — a row written before the enum
   * existed must still render.
   */
  backend: {
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
