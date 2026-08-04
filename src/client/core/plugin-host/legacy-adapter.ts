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
     * fed client rendering. `previewSlugPattern` over the nanoid alternative
     * gives the UI a stable placeholder instead of the throw that used to sit
     * here, which is strictly better: nothing that reached it could work before.
     */
    data: { schema: {} },
    slugPattern: [{ op: 'nanoid', n: 8 }],
    payloadVersion: 1,
    label: def.label,
    labelPlural: def.labelPlural,
    displayOrder: defaults.displayOrder,
    pathPrefix: `/${def.type}s`,
    renderChip: def.renderChip,
    renderCard: def.renderCard,
    renderRow: def.renderRow,
    detailPanel: def.detailPanel,
    useGetBySlug: def.useGetBySlug,
    // Legacy registerEntity() callers don't supply tag-list APIs; return empty.
    listByTags: async () => [],
  };

  clientPluginHost.registerFrontendModule(module);
}
