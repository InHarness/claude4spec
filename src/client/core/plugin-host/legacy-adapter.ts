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

const trivialSlugFrom = (_data: unknown): string => {
  throw new Error(
    'client plugin-host legacy adapter: slugFrom not implemented in Phase 0'
  );
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
    table: defaults.table,
    label: def.label,
    labelPlural: def.labelPlural,
    displayOrder: defaults.displayOrder,
    pathPrefix: `/${def.type}s`,
    slugFrom: trivialSlugFrom,
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
