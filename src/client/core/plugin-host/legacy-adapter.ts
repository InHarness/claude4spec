/**
 * Client legacy adapter — bridges existing registerEntity() calls (the old
 * EntityDef registry in src/client/entities/registry.tsx) into the new
 * client-side plugin host.
 *
 * Phase 0: when registerEntity() is called, we synthesize a FrontendModule
 * manifest from the EntityDef plus per-type defaults (table, displayOrder)
 * and push it into clientPluginHost. The other slots (sidebarTab, routes,
 * editorExtensions, stateSlice) stay empty — existing wiring still drives
 * Sidebar.tsx and router.tsx directly.
 */

import type { EntityDef } from '../../entities/registry.js';
import type { FrontendModule } from './types.js';
import { clientPluginHost } from './host.js';

interface LegacyDefaults {
  table: string;
  displayOrder: number;
}

const LEGACY_DEFAULTS: Record<string, LegacyDefaults> = {
  // All four built-in entity types have been migrated to vertical slice plugins
  // under src/client/entities/{type}/plugin.tsx. Empty defaults map.
};

export function legacyRegisterClientEntity(def: EntityDef<unknown>): void {
  // If a vertical slice plugin already registered this type with a real
  // FrontendModule, do not overwrite it with the synthesized one.
  if (clientPluginHost.getAvailable(def.type)) return;

  const defaults = LEGACY_DEFAULTS[def.type] ?? {
    table: def.type.replace(/-/g, '_'),
    displayOrder: 999,
  };

  const module: FrontendModule = {
    type: def.type,
    /**
     * A legacy `EntityDef` predates the declarative contract entirely: it has no
     * field set to declare and no slug rule to state. An EMPTY schema is the
     * honest answer — it projects to nothing, which is correct, since the SERVER
     * module of the same type owns the projection and this adapter only ever
     * fed client rendering.
     *
     * The slug pattern is a LITERAL placeholder. It used to be `nanoid(8)`,
     * which left the UI a stable row of `#`; the op left the grammar in 0.2.22
     * (a derived title may not be random), and a literal serves the same purpose
     * — a visible "the host fills this in" rather than the throw that used to
     * sit here. Nothing that reaches this adapter could compute a real slug
     * anyway: it has no schema to read one from.
     */
    data: { schema: {} },
    slugPattern: [{ op: 'literal', value: 'legacy' }],
    payloadVersion: 1,
    label: def.label,
    labelPlural: def.labelPlural,
    displayOrder: defaults.displayOrder,
    pathPrefix: `/${def.type}s`,
    renderChip: def.renderChip,
    renderCard: def.renderCard,
    // Spread rather than assign: a hidden def supplies neither slot, and writing
    // `renderRow: undefined` would make the key present with an undefined
    // value, which is not the same as absent to the slot rules — and since
    // 0.2.16 absence is exactly how a hidden entity declares itself.
    ...(def.renderRow ? { renderRow: def.renderRow } : {}),
    // A legacy def cannot contribute `routes` (the shape predates them), so one
    // carrying a `detailPanel` now fails the both-or-neither rule at
    // registration. Nothing in-tree does: the only def that still reaches this
    // adapter is `diagram`, which is hidden. A legacy type that grows a detail
    // panel has outgrown the adapter and wants a real module.
    ...(def.detailPanel ? { detailPanel: def.detailPanel } : {}),
    ...(def.renderOverlay ? { renderOverlay: def.renderOverlay } : {}),
    useGetBySlug: def.useGetBySlug,
    // Legacy registerEntity() callers don't supply tag-list APIs; return empty.
    listByTags: async () => [],
  };

  clientPluginHost.registerFrontendModule(module);
}
