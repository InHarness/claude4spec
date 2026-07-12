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
import type { LucideIcon } from 'lucide-react';
import type { AnyRoute } from '@tanstack/react-router';
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
import type { EditorExtensionRegistration } from '../../tiptap/registry.js';

export interface SidebarTabSlot {
  /** M33/0.1.121: `lucide-react` is a declared, externalized peer — the icon
   * resolves to it directly, not to a copy bundled inside the plugin. */
  icon: LucideIcon;
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

/**
 * L? (M33 phase 3) — a plugin's page-routing contribution. A FACTORY, not a
 * static route array: a plugin can't reference the host's `rootRoute` at
 * authoring time, but `createRoute` needs `getParentRoute: () => rootRoute`. The
 * host calls it once during `mountFrontend`, passing its live `rootRoute`, and
 * mounts the returned routes into its single TanStack Router (see
 * `rebuildRouteTree` in `client/router.tsx`). Routes are deduped by `path`
 * against the host's base routes (first wins).
 */
export type RouteTreeFragment = (ctx: { rootRoute: AnyRoute }) => AnyRoute[];

/**
 * L? (M33 phase 3) — a plugin's optional client state-slice registration.
 * TYPED BUT UNCONSUMED: there is no host store-slice mechanism yet, so
 * `mountFrontend` only acknowledges it via a no-op registration point. Shape is
 * intentionally minimal until a real consumer lands (see the `stateSlice` patch).
 */
export interface StateSliceContribution {
  /** Unique slice key (namespaced by the plugin's entity type by convention). */
  key: string;
  /** Opaque initial state — the host has no store to merge it into yet. */
  initial?: unknown;
}

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

  /**
   * L8 — editor extensions (custom NodeViews, slash commands `/<type>`, mention
   * sources) the host pins onto its single Tiptap instance via `mountFrontend`.
   * Optional; built-in modules register theirs directly, runtime plugins ship
   * them here.
   */
  editorExtensions?: EditorExtensionRegistration[];

  /**
   * Phase 3 — page routes this module owns, as a factory bound to the host's
   * `rootRoute`. The host mounts them into its single TanStack Router. Optional:
   * a module with no pages (e.g. embed-only) omits it.
   */
  routes?: RouteTreeFragment;

  /**
   * Phase 3 — optional client state slice. Typed but currently UNCONSUMED (no
   * host store mechanism); `mountFrontend` only acknowledges it.
   */
  stateSlice?: StateSliceContribution;
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
