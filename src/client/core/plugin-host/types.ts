/**
 * Client-side plugin manifest. Extends the shared EntityModuleManifest with
 * frontend-only slots (React components, sidebar tab, routes, state slice,
 * editor extensions).
 *
 * Phase 0: only render* + detailPanel + useGetBySlug are required because the
 * legacy adapter populates them by wrapping the existing registerEntity()
 * calls. Routes / sidebarTab / editorExtensions are filled in Phase 3 per
 * entity.
 */

import type { ComponentType } from 'react';
import type {
  EntityModuleManifest,
  PluginActivationState,
} from '../../../shared/plugin-host/types.js';
import type {
  EntityChipProps,
  EntityCardProps,
  EntityRowProps,
  EntityDetailProps,
} from '../../entities/registry.js';

export interface SidebarTabSlot {
  icon: ComponentType<{ className?: string; size?: number }>;
  label: string;
  /** Sort order — Pages = 1, Tags = 999, plugins live in between. */
  order: number;
  /** Slot rendered when no entities of this type exist. */
  emptyState?: ComponentType<unknown>;
}

/**
 * Re-exported here so plugins can satisfy the slot shape without depending on
 * the legacy entity registry directly.
 */
export type { EntityChipProps, EntityCardProps, EntityRowProps, EntityDetailProps };

export interface FrontendModule extends EntityModuleManifest {
  /** L8 — chip rendered inline by InlineMentionView etc. */
  renderChip: ComponentType<EntityChipProps<unknown>>;

  /** L8 — full card rendered by SingleElementView. */
  renderCard: ComponentType<EntityCardProps<unknown>>;

  /** L8 — list row rendered by ElementListView / TaggedListView. */
  renderRow: ComponentType<EntityRowProps<unknown>>;

  /** L5 — entity detail panel (sidebar). */
  detailPanel: ComponentType<EntityDetailProps>;

  /** TanStack Query hook for resolving an entity by slug. */
  useGetBySlug: (
    slug: string | null
  ) => { data: unknown | null | undefined; isLoading: boolean };

  /**
   * Async list of entities filtered by tags. Used by TaggedListView /
   * TaggedListMixedView NodeViews to avoid per-type API switches.
   */
  listByTags: (args: { tags: string[]; filter: 'and' | 'or' }) => Promise<Array<{ slug: string }>>;

  /** L5 — sidebar tab descriptor. Optional (some plugins omit a tab). */
  sidebarTab?: SidebarTabSlot;

  // routes, stateSlice, editorExtensions: filled per-entity in Phase 3.
}

export interface ClientPluginHost {
  registerFrontendModule(module: FrontendModule): void;
  /** Apply activation state — usually fed from GET /api/_meta/entities. */
  applyActivation(state: PluginActivationState | null): void;
  listAvailable(): FrontendModule[];
  listEntities(): FrontendModule[];
  getEntity(type: string): FrontendModule | null;
  getAvailable(type: string): FrontendModule | null;
  isActive(type: string): boolean;
}
