/**
 * M33 L11 frontend wiring — the `mountFrontend` step.
 *
 * After plugin modules have handed their slots to `clientPluginHost`, this pins
 * each active module's editor contributions onto the host's single Tiptap setup:
 *   - registers `editorExtensions` (NodeViews, slash commands, mention sources)
 *     into the shared extension REGISTRY, bound to the host's @tiptap/core; and
 *   - auto-adds the entity-type name to the markdown-it xml_inline/xml_block
 *     allowlist so `<type .../>` parses as a native embed in prose.
 *
 * Must run BEFORE the first editor is created (Tiptap freezes its schema at
 * `create`). A module whose slots fail validation is skipped with a warning.
 * No plugin modules ship yet, so this is a no-op.
 */

import { registerEditorExtension, ALL_EDITOR_CONTEXTS } from './registry.js';
import { registerXmlEntityType } from './extensions/xmlNodes.js';
import type { FrontendModule } from '../core/plugin-host/types.js';
import { validateFrontendModule } from '../runtime/validate-slots.js';

export function mountFrontend(modules: FrontendModule[]): void {
  for (const m of modules) {
    const validation = validateFrontendModule(m);
    if (!validation.ok) {
      console.warn(
        `[plugin-host] skipping frontend slots for "${m.type}" — ${validation.reason}`,
      );
      continue;
    }

    // Auto-allow `<type .../>` as an inline + block XML embed in prose.
    registerXmlEntityType(m.type);

    // Pin the plugin's editor extensions onto the shared Tiptap registry.
    for (const ext of m.editorExtensions ?? []) {
      const badContext = (ext.availableIn ?? []).find((c) => !ALL_EDITOR_CONTEXTS.includes(c));
      if (badContext) {
        console.warn(
          `[plugin-host] editor extension "${ext.name}" from "${m.type}" targets unknown context "${badContext}" — skipped`,
        );
        continue;
      }
      try {
        registerEditorExtension(ext);
      } catch (err) {
        console.warn(
          `[plugin-host] editor extension "${ext.name}" from "${m.type}" failed to register: ${
            (err as Error).message
          }`,
        );
      }
    }
  }
}
