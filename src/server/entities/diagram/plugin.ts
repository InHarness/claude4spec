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
  payloadVersion: 2,
  /**
   * 0.2.22 — from `'suffix'` to a hard refusal, and this type is deliberately
   * the only one that moves.
   *
   * Suffixing made sense while the slug came from a transient caption backed by
   * a random fallback: a collision was cheap because the fallback was already
   * random. It comes from `title` now, and two diagrams a person gave the same
   * title are almost never two diagrams — they are one diagram saved twice, or a
   * rename that should have been a rename. `SLUG_CONFLICT` says so. Compare
   * `ac`, which keeps suffixing because two criteria opening the same way are
   * ordinary, and `spreadsheet`, where two sheets called "Q1 report" are normal.
   */
  slugConflict: 'reject',

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
  // 0.2.15 — `<diagram/>` is gone. A diagram is embedded like every other
  // entity: `<single_element type="diagram" slug="…" caption="…"/>` for the
  // block, `<inline_mention type="diagram" slug="…"/>` for the chip. The
  // entity brings its appearance through the client-side render slots
  // (`renderCard` / `renderChip`), not through a tag of its own.
};

export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(diagramBackendModule);
}
